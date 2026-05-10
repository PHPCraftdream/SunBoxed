// sundocked-dns-proxy: tiny DNS->DoH proxy.
//
// Listens on UDP:53 and TCP:53 (127.0.0.1 by default), forwards every
// query verbatim to a DoH endpoint (Cloudflare 1.1.1.1 by default) using
// RFC 8484 wire format, and returns the response unchanged.
//
// Purpose: bypass kernel-level UDP:53 hijacking by enterprise endpoint
// security drivers (e.g. Cisco Secure Client / acsock64.sys) when running
// inside a Docker container. UDP:53 traffic from the container's
// 127.0.0.1 never leaves the container's network namespace, so the host
// kernel's WFP filter never sees it; the actual upstream is HTTPS to
// 1.1.1.1, which those filters do not intercept.
//
// No DNS parsing — DoH wire format is the same DNS message in HTTP body.
package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	// Embed Mozilla's root CA bundle as a fallback. Auto-registers when
	// the system trust store at /etc/ssl/certs/* is missing or empty —
	// the case on minimal images like distroless and node:*-slim, which
	// do not ship the ca-certificates package. Without this we cannot
	// verify any DoH endpoint's TLS cert.
	_ "golang.org/x/crypto/x509roots/fallback"
)

const (
	defaultBind        = "127.0.0.1:53"
	dnsContentType     = "application/dns-message"
	httpClientTimeout  = 3 * time.Second
	tcpReadTimeout     = 15 * time.Second
	maxDNSMessage      = 65535
	udpReadBufferBytes = 4096
)

// defaultUpstreams: tried in order until one succeeds. URLs use the
// provider's REAL hostname (so TLS SNI = hostname, which corporate
// VPN/MITM stacks like Cisco Secure Client are less likely to intercept
// than SNI=<IP-literal>). Resolution to an IP is done by us, not the
// system resolver — see addrMap below — to avoid the chicken-and-egg of
// "we ARE the system resolver".
//
// Diversity is intentional: different jurisdictions (US/CH/DE/SE/CN) and
// different operators, so a single provider outage or regional egress
// block does not take everything down. Order roughly minimizes p50
// latency on a healthy network.
type upstreamCfg struct {
	URL string   // https://cloudflare-dns.com/dns-query — TLS SNI = the host part
	IPs []string // hardcoded IPs for this hostname; tried in order on dial
}

var defaultUpstreams = []upstreamCfg{
	// Cloudflare — anycast, lowest p50 latency globally, no logging.
	{"https://cloudflare-dns.com/dns-query", []string{"1.1.1.1", "1.0.0.1"}},
	// Google Public DNS — most universally reachable.
	{"https://dns.google/dns-query", []string{"8.8.8.8", "8.8.4.4"}},
	// Quad9 — Switzerland, malware-blocking; .10 variants skip the blocklist.
	{"https://dns.quad9.net/dns-query", []string{"9.9.9.9", "149.112.112.112"}},
	{"https://dns10.quad9.net/dns-query", []string{"9.9.9.10", "149.112.112.10"}},
	// AdGuard — Cyprus/Russia infra; .14/.15 = ads-and-trackers, .140/.141 = unfiltered.
	{"https://dns.adguard-dns.com/dns-query", []string{"94.140.14.14", "94.140.15.15"}},
	{"https://unfiltered.adguard-dns.com/dns-query", []string{"94.140.14.140", "94.140.14.141"}},
	// Mullvad — Sweden, no-logs, multiple flavors.
	{"https://dns.mullvad.net/dns-query", []string{"194.242.2.2"}},
	{"https://adblock.dns.mullvad.net/dns-query", []string{"194.242.2.3"}},
	{"https://family.dns.mullvad.net/dns-query", []string{"194.242.2.4"}},
	{"https://all.dns.mullvad.net/dns-query", []string{"194.242.2.9"}},
	// AliDNS — China; useful when Western providers are egress-blocked.
	{"https://dns.alidns.com/dns-query", []string{"223.5.5.5", "223.6.6.6"}},
}

// dialMap maps "host:port" to a list of hardcoded IPs to try. Built
// from defaultUpstreams at startup; consulted by our custom DialContext
// before falling back to system DNS.
func buildDialMap(ups []upstreamCfg) map[string][]string {
	m := make(map[string][]string, len(ups))
	for _, u := range ups {
		host := hostOf(u.URL)
		if host == "" || len(u.IPs) == 0 {
			continue
		}
		// DoH always runs on 443; pre-key for that.
		m[host+":443"] = append(m[host+":443"], u.IPs...)
	}
	return m
}

func env(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}

func splitCSV(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// selectUpstreams resolves the URL list from env overrides or defaults.
// Returned URLs are what http.Client.Do sees; IP mapping (for SNI-aware
// dialing) is held separately by buildDialMap(defaultUpstreams).
func selectUpstreams() []string {
	if v := os.Getenv("SUNDOCKED_DOH_URLS"); v != "" {
		return splitCSV(v)
	}
	urls := make([]string, 0, len(defaultUpstreams)+4)
	urls = append(urls, splitCSV(os.Getenv("SUNDOCKED_DOH_EXTRA"))...)
	for _, u := range defaultUpstreams {
		urls = append(urls, u.URL)
	}
	return urls
}

func main() {
	bind := env("SUNDOCKED_DNS_BIND", defaultBind)
	// Build the upstream list. URLs only here — the IP mapping for our
	// known hostnames lives in defaultUpstreams.IPs. User-supplied URLs
	// via env vars must use either a hostname we know how to dial (one
	// of the defaults) or be IP-literal (in which case TLS SNI = IP and
	// some corporate MITM stacks may intercept).
	upstreams := selectUpstreams()

	dialMap := buildDialMap(defaultUpstreams)
	dialer := &net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}
	dialContext := func(ctx context.Context, network, addr string) (net.Conn, error) {
		if ips, ok := dialMap[addr]; ok {
			var lastErr error
			for _, ip := range ips {
				_, port, _ := net.SplitHostPort(addr)
				conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(ip, port))
				if err == nil {
					return conn, nil
				}
				lastErr = err
			}
			if lastErr != nil {
				return nil, lastErr
			}
		}
		// Unknown host — fall back to system DNS. Will usually fail
		// inside the container (resolv.conf points at us, we're not up
		// for that name). User-supplied IP-literal URLs work directly.
		return dialer.DialContext(ctx, network, addr)
	}

	// Force HTTP/1.1 with explicit Content-Length. Some corporate
	// VPN/MITM stacks reject our HTTP/2 framing for IP-literal hosts
	// with chunked POST bodies; HTTP/1.1 is the most-compatible thing.
	client := &http.Client{
		Timeout: httpClientTimeout,
		Transport: &http.Transport{
			DialContext:         dialContext,
			MaxIdleConns:        16,
			MaxIdleConnsPerHost: 8,
			IdleConnTimeout:     90 * time.Second,
			ForceAttemptHTTP2:   false,
			TLSNextProto:        map[string]func(authority string, c *tls.Conn) http.RoundTripper{},
		},
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	udpAddr, err := net.ResolveUDPAddr("udp", bind)
	if err != nil {
		log.Fatalf("resolve udp %s: %v", bind, err)
	}
	udpConn, err := net.ListenUDP("udp", udpAddr)
	if err != nil {
		log.Fatalf("listen udp %s: %v", bind, err)
	}
	defer udpConn.Close()

	tcpLn, err := net.Listen("tcp", bind)
	if err != nil {
		log.Fatalf("listen tcp %s: %v", bind, err)
	}
	defer tcpLn.Close()

	pool := newPool(upstreams)
	log.Printf("sundocked-dns: listening on %s, upstreams=%v", bind, upstreams)

	// Periodic stats — useful for debugging which upstreams are reachable
	// in this network. Quiet at first (skipped if no traffic yet).
	statsInterval := 60 * time.Second
	if v := os.Getenv("SUNDOCKED_STATS_INTERVAL"); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			statsInterval = d
		}
	}
	go func() {
		t := time.NewTicker(statsInterval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				log.Printf("upstreams: %s", pool.statsLine())
			}
		}
	}()

	go serveTCP(ctx, tcpLn, client, pool)
	go serveUDP(ctx, udpConn, client, pool)

	<-ctx.Done()
	log.Printf("sundocked-dns: shutting down (final upstreams: %s)", pool.statsLine())
}

func serveUDP(ctx context.Context, conn *net.UDPConn, client *http.Client, pool *pool) {
	for {
		if ctx.Err() != nil {
			return
		}
		buf := make([]byte, udpReadBufferBytes)
		_ = conn.SetReadDeadline(time.Now().Add(1 * time.Second))
		n, peer, err := conn.ReadFromUDP(buf)
		if err != nil {
			var ne net.Error
			if errors.As(err, &ne) && ne.Timeout() {
				continue
			}
			if ctx.Err() != nil {
				return
			}
			continue
		}
		query := buf[:n:n]
		go func(q []byte, p *net.UDPAddr) {
			resp, err := dohExchange(ctx, client, pool, q)
			if err != nil {
				return
			}
			_ = conn.SetWriteDeadline(time.Now().Add(2 * time.Second))
			_, _ = conn.WriteToUDP(resp, p)
		}(query, peer)
	}
}

func serveTCP(ctx context.Context, ln net.Listener, client *http.Client, pool *pool) {
	go func() {
		<-ctx.Done()
		_ = ln.Close()
	}()
	for {
		c, err := ln.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			continue
		}
		go handleTCP(ctx, c, client, pool)
	}
}

func handleTCP(ctx context.Context, c net.Conn, client *http.Client, pool *pool) {
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(tcpReadTimeout))
	var lenbuf [2]byte
	if _, err := io.ReadFull(c, lenbuf[:]); err != nil {
		return
	}
	n := int(lenbuf[0])<<8 | int(lenbuf[1])
	if n == 0 || n > maxDNSMessage {
		return
	}
	msg := make([]byte, n)
	if _, err := io.ReadFull(c, msg); err != nil {
		return
	}
	resp, err := dohExchange(ctx, client, pool, msg)
	if err != nil || len(resp) > maxDNSMessage {
		return
	}
	out := make([]byte, 2+len(resp))
	out[0] = byte(len(resp) >> 8)
	out[1] = byte(len(resp))
	copy(out[2:], resp)
	_, _ = c.Write(out)
}

// upstream tracks per-DoH-server availability stats. The pool reorders
// items by score (successes - failures) so chronically-failing servers
// drift to the bottom and chronically-working ones stay at the top.
//
// score = successes - failures (signed). Stable sort preserves original
// order on ties — matters at cold start when all scores are zero, so
// the order specified in defaultUpstreams (Cloudflare first) is honored
// until real outcomes accumulate.
//
// Recovery: a previously-bad server stays at the bottom but is still
// retried on every query (we walk the entire ordered list on failure of
// higher-ranked servers). One success against ten previous failures
// nudges the score from -10 to -9, gradually pulling it back up.
type upstream struct {
	url       string
	successes atomic.Uint64
	failures  atomic.Uint64
}

func (u *upstream) score() int64 {
	return int64(u.successes.Load()) - int64(u.failures.Load())
}

type pool struct {
	items []*upstream
	mu    sync.RWMutex
	order []int
}

func newPool(urls []string) *pool {
	items := make([]*upstream, len(urls))
	order := make([]int, len(urls))
	for i, u := range urls {
		items[i] = &upstream{url: u}
		order[i] = i
	}
	return &pool{items: items, order: order}
}

func (p *pool) snapshot() []int {
	p.mu.RLock()
	defer p.mu.RUnlock()
	out := make([]int, len(p.order))
	copy(out, p.order)
	return out
}

func (p *pool) record(idx int, success bool) {
	if success {
		p.items[idx].successes.Add(1)
	} else {
		p.items[idx].failures.Add(1)
	}
	p.mu.Lock()
	sort.SliceStable(p.order, func(a, b int) bool {
		return p.items[p.order[a]].score() > p.items[p.order[b]].score()
	})
	p.mu.Unlock()
}

func (p *pool) statsLine() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	parts := make([]string, 0, len(p.order))
	for _, idx := range p.order {
		u := p.items[idx]
		s, f := u.successes.Load(), u.failures.Load()
		if s == 0 && f == 0 {
			continue
		}
		parts = append(parts, fmt.Sprintf("%s(+%d/-%d)", hostOf(u.url), s, f))
	}
	if len(parts) == 0 {
		return "no traffic yet"
	}
	return strings.Join(parts, " ")
}

func hostOf(rawURL string) string {
	s := rawURL
	if i := strings.Index(s, "://"); i >= 0 {
		s = s[i+3:]
	}
	if i := strings.Index(s, "/"); i >= 0 {
		s = s[:i]
	}
	return s
}

func dohExchange(ctx context.Context, client *http.Client, p *pool, query []byte) ([]byte, error) {
	order := p.snapshot()
	if len(order) == 0 {
		return nil, errors.New("no upstreams")
	}
	var lastErr error
	for _, idx := range order {
		body, err := dohOnce(ctx, client, p.items[idx].url, query)
		if err == nil {
			p.record(idx, true)
			return body, nil
		}
		p.record(idx, false)
		if os.Getenv("SUNDOCKED_DEBUG") != "" {
			log.Printf("doh %s: %v", p.items[idx].url, err)
		}
		lastErr = err
	}
	return nil, lastErr
}

func dohOnce(ctx context.Context, client *http.Client, url string, query []byte) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(query))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", dnsContentType)
	req.Header.Set("Accept", dnsContentType)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("doh %s: status %d", url, resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, maxDNSMessage))
}
