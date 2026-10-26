#!/usr/bin/env python3
"""
Custom HTTP Server & IPTV Proxy with OTT Navigator User-Agent, Stream Resolver,
MPEG-DASH BaseURL rewriter, ClearKey License Extractor, and M3U8 Master/Media Playlist rewriter.
"""

import http.server
import socketserver
import urllib.request
import urllib.parse
import json
import sys
import os
import re

PORT = int(os.environ.get('PORT', sys.argv[1] if len(sys.argv) > 1 else 8085))
DEFAULT_UA = "OTT Navigator/1.7.0.2"

KNOWN_CLEARKEYS = {
    'sports_key.php': {
        "keys": [
            {
                "kty": "oct",
                "kid": "YMDZtBR14B70_7ke1Vf7zA",
                "k": "Nu5A5YlIyhXjyrqNR2jzSw"
            }
        ],
        "type": "temporary"
    },
    'chlajabsdk': {
        "keys": [
            {
                "kty": "oct",
                "kid": "A8Lgry-BWfnwzptdvIZfEA",
                "k": "zYTtE2sMxx-KuM1NT2ouTA"
            }
        ],
        "type": "temporary"
    },
    'sling_ck': {
        "keys": [
            {
                "kty": "oct",
                "kid": "A8Lgry-BWfnwzptdvIZfEA",
                "k": "zYTtE2sMxx-KuM1NT2ouTA"
            }
        ],
        "type": "temporary"
    }
}


class NoGithubRedirectHandler(urllib.request.HTTPRedirectHandler):
    """
    Prevents hangs caused by upstream event streams redirecting to offline
    placeholder repositories on raw.githubusercontent.com.
    """
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if 'github.com' in newurl or 'raw.githubusercontent.com' in newurl:
            raise urllib.error.HTTPError(newurl, 404, 'Event stream is inactive or offline', headers, None)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


custom_opener = urllib.request.build_opener(NoGithubRedirectHandler)


def rewrite_m3u8(content_str, base_url, ua, ref=None):
    """
    Rewrites an M3U8 playlist (master or media) so that all child variant playlists,
    audio/subtitle renditions, AES-128 keys, initialization segments, and media chunks
    are fetched through the local /proxy endpoint with the proper User-Agent and Referer.
    """
    output_lines = []
    proxy_path = '/proxy'
    ref_param = f"&ref={urllib.parse.quote(ref)}" if ref else ""

    for line in content_str.splitlines():
        line_str = line.strip()
        if not line_str:
            output_lines.append(line)
            continue

        if line_str.startswith('#'):
            # Check for URI="..." in tags like #EXT-X-KEY, #EXT-X-MAP, #EXT-X-MEDIA
            if 'URI="' in line_str:
                def replace_uri(match):
                    raw_uri = match.group(1)
                    full_uri = urllib.parse.urljoin(base_url, raw_uri)
                    proxied = f"{proxy_path}?url={urllib.parse.quote(full_uri)}&ua={urllib.parse.quote(ua)}{ref_param}"
                    return f'URI="{proxied}"'

                rewritten = re.sub(r'URI="([^"]+)"', replace_uri, line_str)
                output_lines.append(rewritten)
            else:
                output_lines.append(line_str)
        else:
            # Media segment or variant playlist line
            full_uri = urllib.parse.urljoin(base_url, line_str)
            proxied = f"{proxy_path}?url={urllib.parse.quote(full_uri)}&ua={urllib.parse.quote(ua)}{ref_param}"
            output_lines.append(proxied)

    return '\n'.join(output_lines)


class IPTVProxyHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Enable CORS on all responses
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_HEAD(self):
        parsed_path = urllib.parse.urlparse(self.path)

        if parsed_path.path == '/proxy' or parsed_path.path.startswith('/proxy'):
            query = urllib.parse.parse_qs(parsed_path.query)
            target_url = query.get('url', [None])[0]
            custom_ua = query.get('ua', [DEFAULT_UA])[0]
            custom_ref = query.get('ref', [None])[0]

            if not target_url:
                self.send_response(400)
                self.end_headers()
                return

            # Unwrap any nested /proxy?url=
            while target_url and (target_url.startswith('/proxy') or target_url.startswith('proxy')):
                sub_q = urllib.parse.urlsplit(target_url).query
                sub_params = urllib.parse.parse_qs(sub_q)
                if 'url' in sub_params:
                    target_url = sub_params['url'][0]
                else:
                    break

            if '|Referer=' in target_url:
                target_url, _, pipe_ref = target_url.partition('|Referer=')
                if not custom_ref:
                    custom_ref = pipe_ref
            if '|User-Agent=' in target_url:
                target_url, _, pipe_ua = target_url.partition('|User-Agent=')
                custom_ua = pipe_ua

            try:
                headers = {'User-Agent': custom_ua, 'Accept': '*/*'}
                if custom_ref:
                    headers['Referer'] = custom_ref
                if 'Range' in self.headers:
                    headers['Range'] = self.headers['Range']

                if 'fancode' in target_url:
                    headers.setdefault('Referer', 'https://fancode.com/')
                elif 'slivcdn.com' in target_url or 'sliv-' in target_url or 'suluv' in target_url:
                    headers['User-Agent'] = 'OTT Navigator/1.7.0.2'
                    headers.setdefault('Referer', 'https://la.drmlive.net/')
                elif 'zee5.com' in target_url or '/zee5/' in target_url:
                    headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
                    headers.setdefault('Referer', 'https://www.zee5.com/')
                elif 'jt.drmlive.net' in target_url or 'jio' in target_url:
                    headers['User-Agent'] = 'OTT Navigator/1.7.0.2'
                elif 'star-' in target_url or 'hotstar' in target_url:
                    headers['User-Agent'] = 'Hotstar;in.startv.hotstar/24.10.07.2.10542 (Android/9)'
                    headers.setdefault('Referer', 'https://www.hotstar.com/')

                req = urllib.request.Request(target_url, headers=headers, method='HEAD')
                with custom_opener.open(req, timeout=6) as resp:
                    self.send_response(resp.status)
                    ct = resp.headers.get('Content-Type', '')
                    if '.mpd' in target_url:
                        ct = 'application/dash+xml'
                    elif '.m3u8' in target_url:
                        ct = 'application/vnd.apple.mpegurl; charset=utf-8'
                    if ct:
                        self.send_header('Content-Type', ct)
                    if 'Content-Length' in resp.headers:
                        self.send_header('Content-Length', resp.headers['Content-Length'])
                    self.send_header('Accept-Ranges', 'bytes')
                    self.end_headers()
            except Exception:
                # Upstream might reject HEAD; reply 200 with proper media type
                self.send_response(200)
                ct = 'video/mp4'
                if '.mpd' in target_url:
                    ct = 'application/dash+xml'
                elif '.m3u8' in target_url:
                    ct = 'application/vnd.apple.mpegurl; charset=utf-8'
                self.send_header('Content-Type', ct)
                self.send_header('Accept-Ranges', 'bytes')
                self.end_headers()
            return

        if parsed_path.path == '/resolve':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            return

        super().do_HEAD()

    def do_POST(self):
        parsed_path = urllib.parse.urlparse(self.path)

        if parsed_path.path == '/proxy' or parsed_path.path.startswith('/proxy'):
            query = urllib.parse.parse_qs(parsed_path.query)
            target_url = query.get('url', [None])[0]
            custom_ua = query.get('ua', [DEFAULT_UA])[0]
            custom_ref = query.get('ref', [None])[0]

            if not target_url:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b'Missing url parameter')
                return

            # Unwrap any nested /proxy?url=
            while target_url and (target_url.startswith('/proxy') or target_url.startswith('proxy')):
                sub_q = urllib.parse.urlsplit(target_url).query
                sub_params = urllib.parse.parse_qs(sub_q)
                if 'url' in sub_params:
                    target_url = sub_params['url'][0]
                else:
                    break

            if '|Referer=' in target_url:
                target_url, _, pipe_ref = target_url.partition('|Referer=')
                if not custom_ref:
                    custom_ref = pipe_ref
            if '|User-Agent=' in target_url:
                target_url, _, pipe_ua = target_url.partition('|User-Agent=')
                custom_ua = pipe_ua

            # Return known static ClearKey JSON directly
            for key_id, jwk_dict in KNOWN_CLEARKEYS.items():
                if key_id in target_url:
                    resp_data = json.dumps(jwk_dict).encode('utf-8')
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', str(len(resp_data)))
                    self.end_headers()
                    self.wfile.write(resp_data)
                    return

            try:
                # Read POST body (e.g. DRM license challenge)
                content_length = int(self.headers.get('Content-Length', 0))
                post_body = self.rfile.read(content_length) if content_length > 0 else None

                req_headers = {
                    'User-Agent': custom_ua,
                    'Accept': '*/*'
                }
                if 'Content-Type' in self.headers:
                    req_headers['Content-Type'] = self.headers['Content-Type']
                if custom_ref:
                    req_headers['Referer'] = custom_ref

                if 'fancode' in target_url:
                    req_headers.setdefault('Referer', 'https://fancode.com/')
                elif 'slivcdn.com' in target_url or 'sliv-' in target_url or 'suluv' in target_url:
                    req_headers['User-Agent'] = 'OTT Navigator/1.7.0.2'
                    req_headers.setdefault('Referer', 'https://la.drmlive.net/')
                elif 'jt.drmlive.net' in target_url or 'jio' in target_url:
                    req_headers['User-Agent'] = 'OTT Navigator/1.7.0.2'
                    req_headers.pop('Referer', None)
                elif 'star-' in target_url or 'hotstar' in target_url:
                    req_headers['User-Agent'] = 'Hotstar;in.startv.hotstar/24.10.07.2.10542 (Android/9)'
                    req_headers.setdefault('Referer', 'https://www.hotstar.com/')

                # Follow 301, 302, 307, 308 redirects on POST
                current_url = target_url
                resp = None
                for _ in range(5):
                    req = urllib.request.Request(
                        current_url,
                        data=post_body,
                        headers=req_headers,
                        method='POST'
                    )
                    try:
                        resp = urllib.request.urlopen(req, timeout=15)
                        break
                    except urllib.error.HTTPError as redir_err:
                        if redir_err.code in (301, 302, 303, 307, 308) and 'Location' in redir_err.headers:
                            current_url = redir_err.headers['Location']
                            continue
                        # If upstream returned 403 or other status, but body has valid ClearKey JSON JWK
                        try:
                            err_body = redir_err.read()
                            if b'"keys"' in err_body:
                                self.send_response(200)
                                self.send_header('Content-Type', 'application/json')
                                self.send_header('Content-Length', str(len(err_body)))
                                self.end_headers()
                                self.wfile.write(err_body)
                                return
                        except Exception:
                            pass
                        raise

                if resp:
                    with resp:
                        self.send_response(resp.status)
                        if 'Content-Type' in resp.headers:
                            self.send_header('Content-Type', resp.headers['Content-Type'])
                        self.end_headers()

                        while True:
                            chunk = resp.read(65536)
                            if not chunk:
                                break
                            self.wfile.write(chunk)

            except Exception as e:
                # If exception is HTTPError containing valid ClearKey JSON
                if isinstance(e, urllib.error.HTTPError):
                    try:
                        err_body = e.read()
                        if b'"keys"' in err_body:
                            self.send_response(200)
                            self.send_header('Content-Type', 'application/json')
                            self.send_header('Content-Length', str(len(err_body)))
                            self.end_headers()
                            self.wfile.write(err_body)
                            return
                    except Exception:
                        pass

                # Fallback to known ClearKey if upstream fails
                for key_id, jwk_dict in KNOWN_CLEARKEYS.items():
                    if key_id in target_url:
                        resp_data = json.dumps(jwk_dict).encode('utf-8')
                        self.send_response(200)
                        self.send_header('Content-Type', 'application/json')
                        self.send_header('Content-Length', str(len(resp_data)))
                        self.end_headers()
                        self.wfile.write(resp_data)
                        return

                self.send_response(502)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))
            return

        self.send_response(405)
        self.end_headers()

    def do_GET(self):
        parsed_path = urllib.parse.urlparse(self.path)

        # /resolve endpoint: follows 302 redirects and returns final destination URL
        if parsed_path.path == '/resolve':
            query = urllib.parse.parse_qs(parsed_path.query)
            target_url = query.get('url', [None])[0]
            custom_ua = query.get('ua', [DEFAULT_UA])[0]
            custom_ref = query.get('ref', [None])[0]

            if not target_url:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b'Missing url')
                return

            if '|Referer=' in target_url:
                target_url, _, pipe_ref = target_url.partition('|Referer=')
                if not custom_ref:
                    custom_ref = pipe_ref

            try:
                headers = {'User-Agent': custom_ua}
                if custom_ref:
                    headers['Referer'] = custom_ref
                req = urllib.request.Request(target_url, headers=headers)
                with custom_opener.open(req, timeout=12) as resp:
                    final_url = resp.geturl()
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({'url': final_url}).encode('utf-8'))
            except Exception as e:
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e), 'url': target_url}).encode('utf-8'))
            return

        # /proxy endpoint: fetches content with custom User-Agent and rewrites manifests
        if parsed_path.path == '/proxy' or parsed_path.path.startswith('/proxy'):
            query = urllib.parse.parse_qs(parsed_path.query)
            target_url = query.get('url', [None])[0]
            custom_ua = query.get('ua', [DEFAULT_UA])[0]
            custom_ref = query.get('ref', [None])[0]

            if not target_url:
                self.send_response(400)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self.wfile.write(b'Missing url parameter')
                return

            # Unwrap any nested /proxy?url=
            while target_url and (target_url.startswith('/proxy') or target_url.startswith('proxy')):
                sub_q = urllib.parse.urlsplit(target_url).query
                sub_params = urllib.parse.parse_qs(sub_q)
                if 'url' in sub_params:
                    target_url = sub_params['url'][0]
                else:
                    break

            if '|Referer=' in target_url:
                target_url, _, pipe_ref = target_url.partition('|Referer=')
                if not custom_ref:
                    custom_ref = pipe_ref
            if '|User-Agent=' in target_url:
                target_url, _, pipe_ua = target_url.partition('|User-Agent=')
                custom_ua = pipe_ua

            # Check if this is a known static/IP-banned ClearKey license URL
            for key_id, jwk_dict in KNOWN_CLEARKEYS.items():
                if key_id in target_url:
                    resp_data = json.dumps(jwk_dict).encode('utf-8')
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', str(len(resp_data)))
                    self.end_headers()
                    self.wfile.write(resp_data)
                    return

            try:
                headers = {
                    'User-Agent': custom_ua,
                    'Accept': '*/*'
                }
                if custom_ref:
                    headers['Referer'] = custom_ref
                if 'Range' in self.headers:
                    headers['Range'] = self.headers['Range']

                if 'fancode' in target_url:
                    headers.setdefault('Referer', 'https://fancode.com/')
                    if 'sportsfancode.mpd' in target_url or 'sportsfancode2.mpd' in target_url:
                        target_url = 'https://mix.drmlive.net/mix/fancode-2.m3u8?category=cricket'
                    elif 'fancode-' in target_url and '?category=' not in target_url:
                        target_url += '?category=cricket'
                elif 'slivcdn.com' in target_url or 'sliv-' in target_url or 'suluv' in target_url:
                    headers['User-Agent'] = 'OTT Navigator/1.7.0.2'
                    headers.setdefault('Referer', 'https://la.drmlive.net/')
                elif 'zee5.com' in target_url or '/zee5/' in target_url:
                    headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
                    headers.setdefault('Referer', 'https://www.zee5.com/')
                elif 'jt.drmlive.net' in target_url or 'jio' in target_url:
                    headers['User-Agent'] = 'OTT Navigator/1.7.0.2'
                    headers.pop('Referer', None)
                elif 'star-' in target_url or 'hotstar' in target_url:
                    headers['User-Agent'] = 'Hotstar;in.startv.hotstar/24.10.07.2.10542 (Android/9)'
                    headers.setdefault('Referer', 'https://www.hotstar.com/')

                req = urllib.request.Request(target_url, headers=headers)
                resp = None
                try:
                    resp = custom_opener.open(req, timeout=25)
                except urllib.error.HTTPError as http_err:
                    if 'fancode' in target_url:
                        fallback_target = 'https://mix.drmlive.net/mix/fancode-2.m3u8?category=cricket' if 'fancode-1' in target_url else 'https://mix.drmlive.net/mix/fancode-1.m3u8?category=cricket'
                        print(f"[Proxy] Fancode feed offline ({http_err}), seamlessly falling back to {fallback_target}", flush=True)
                        req_fb = urllib.request.Request(fallback_target, headers=headers)
                        resp = custom_opener.open(req_fb, timeout=25)
                    else:
                        raise http_err
                except Exception as err:
                    if 'fancode' in target_url:
                        fallback_target = 'https://mix.drmlive.net/mix/fancode-2.m3u8?category=cricket' if 'fancode-1' in target_url else 'https://mix.drmlive.net/mix/fancode-1.m3u8?category=cricket'
                        print(f"[Proxy] Fancode feed error ({err}), seamlessly falling back to {fallback_target}", flush=True)
                        req_fb = urllib.request.Request(fallback_target, headers=headers)
                        resp = custom_opener.open(req_fb, timeout=25)
                    else:
                        raise err

                with resp:
                    final_url = resp.geturl()
                    content_type = resp.headers.get('Content-Type', '')
                    data = resp.read()

                    # Fallback between Fancode feeds if one is offline / redirected to github placeholder
                    if 'fancode' in target_url and ('githubusercontent.com' in final_url or 'stream.m3u8' in final_url or b'playlist1.ts' in data):
                        fallback_target = 'https://mix.drmlive.net/mix/fancode-2.m3u8?category=cricket' if 'fancode-1' in target_url else 'https://mix.drmlive.net/mix/fancode-1.m3u8?category=cricket'
                        try:
                            req_fb = urllib.request.Request(fallback_target, headers=headers)
                            with custom_opener.open(req_fb, timeout=8) as resp_fb:
                                final_fb = resp_fb.geturl()
                                if 'githubusercontent.com' not in final_fb and 'stream.m3u8' not in final_fb:
                                    final_url = final_fb
                                    content_type = resp_fb.headers.get('Content-Type', '')
                                    data = resp_fb.read()
                        except Exception as fb_err:
                            print(f"[Proxy] Fancode fallback failed: {fb_err}", flush=True)

                    # 1. Handle MPEG-DASH manifest (.mpd)
                    if b'<MPD' in data:
                        # Cleanly parse base directory and query tokens
                        url_parts = urllib.parse.urlsplit(final_url)
                        base_path = url_parts.path.rsplit('/', 1)[0] + '/'
                        query_str = f"?{url_parts.query}" if url_parts.query else ""

                        # If manifest has NO <BaseURL> tag at all (e.g. Fancode, Willow, Prime Video CDN)
                        if b'<BaseURL>' not in data:
                            cdn_base = f"{url_parts.scheme}://{url_parts.netloc}{base_path}{query_str}"
                            data = re.sub(rb'(<MPD\b[^>]*>)', rb'\1\n  <BaseURL>' + cdn_base.encode('utf-8') + rb'</BaseURL>', data, count=1)
                        elif b'<BaseURL>dash/</BaseURL>' in data:
                            # If Broadpeak manifest has relative <BaseURL>dash/</BaseURL>
                            cdn_dash = f"{url_parts.scheme}://{url_parts.netloc}{base_path}dash/{query_str}"
                            data = data.replace(b'<BaseURL>dash/</BaseURL>', f'<BaseURL>{cdn_dash}</BaseURL>'.encode('utf-8'))
                        elif b'<BaseURL>' in data and not b'<BaseURL>http' in data:
                            cdn_base = f"{url_parts.scheme}://{url_parts.netloc}{base_path}{query_str}"
                            data = re.sub(rb'<BaseURL>(?!https?://)([^<]+)</BaseURL>',
                                          lambda m: f'<BaseURL>{url_parts.scheme}://{url_parts.netloc}{base_path}{m.group(1).decode("utf-8")}{query_str}</BaseURL>'.encode('utf-8'),
                                          data)

                        # Upgrade insecure HTTP BaseURLs to HTTPS for modern browser/mixed-content compliance
                        if b'<BaseURL' in data and b'>http://' in data:
                            data = re.sub(rb'<BaseURL([^>]*)>http://([^<]+)</BaseURL>', rb'<BaseURL\1>https://\2</BaseURL>', data)

                        # Fix Broadpeak BaseURL query string loss in Shaka Player (only for direct CDN URLs, not our /proxy endpoints)
                        m_bp = re.search(rb'<BaseURL>(https?://[^<]+)\?([^<]+)</BaseURL>', data)
                        if m_bp:
                            base_clean = m_bp.group(1)
                            bp_query = m_bp.group(2)
                            data = data.replace(m_bp.group(0), b'<BaseURL>' + base_clean + b'</BaseURL>')
                            query_xml = bp_query.replace(b'&amp;', b'&').replace(b'&', b'&amp;')

                            def append_bp_query(match):
                                attr_name = match.group(1)
                                attr_val = match.group(2)
                                if b'__hdnea__' in attr_val or (b'?' in attr_val and bp_query in attr_val):
                                    return match.group(0)
                                sep = b'&amp;' if b'?' in attr_val else b'?'
                                return attr_name + b'="' + attr_val + sep + query_xml + b'"'

                            data = re.sub(rb'(initialization|media)="([^"]+)"', append_bp_query, data)

                        # Inject UTCTiming element for dynamic live manifests if missing
                        if b'type="dynamic"' in data and b'<UTCTiming' not in data:
                            utc_tag = b'\n  <UTCTiming schemeIdUri="urn:mpeg:dash:utc:http-iso:2014" value="https://time.akamai.com/?iso"/>'
                            data = re.sub(rb'(<MPD\b[^>]*>)', rb'\1' + utc_tag, data, count=1)

                        # Ensure root MPD element declares xmlns:cenc namespace so child elements don't fail XML validation
                        m_mpd = re.search(rb'<MPD\b([^>]*)>', data)
                        if m_mpd and b'xmlns:cenc=' not in m_mpd.group(1):
                            data = data.replace(m_mpd.group(0), b'<MPD xmlns:cenc="urn:mpeg:cenc:2013"' + m_mpd.group(1) + b'>', 1)

                        # Inject ClearKey ContentProtection UUID if only cenc/Widevine are declared
                        if b'urn:uuid:e2719d58-a985-b3c9-781a-b030af78d30e' not in data and b'urn:uuid:1077efec-c0b2-4d02-ace3-3c1e52e2fb4b' not in data:
                            cp_pattern = rb'(<ContentProtection\b[^>]*schemeIdUri=[\'"]urn:mpeg:dash:mp4protection:2011[\'"][^>]*>[\s\S]*?</ContentProtection>|<ContentProtection\b[^>]*schemeIdUri=[\'"]urn:mpeg:dash:mp4protection:2011[\'"][^>]*/>)'
                            if re.search(cp_pattern, data):
                                def repl_cp(m):
                                    full_tag = m.group(0)
                                    kid_match = re.search(rb'cenc:default_KID=[\'"]([^\'"]+)[\'"]', full_tag)
                                    kid_attr = (b' xmlns:cenc="urn:mpeg:cenc:2013" cenc:default_KID="' + kid_match.group(1) + b'"') if kid_match else b''
                                    ck_dashif = b'\n   <ContentProtection schemeIdUri="urn:uuid:e2719d58-a985-b3c9-781a-b030af78d30e"' + kid_attr + b'/>'
                                    ck_w3c = b'\n   <ContentProtection schemeIdUri="urn:uuid:1077efec-c0b2-4d02-ace3-3c1e52e2fb4b"' + kid_attr + b'/>'
                                    return full_tag + ck_dashif + ck_w3c
                                data = re.sub(cp_pattern, repl_cp, data)
                            elif b'<Role schemeIdUri="urn:mpeg:dash:role:2011" value="main"/>' in data:
                                clearkey_tag = b'\n   <ContentProtection schemeIdUri="urn:uuid:e2719d58-a985-b3c9-781a-b030af78d30e"/>\n   <ContentProtection schemeIdUri="urn:uuid:1077efec-c0b2-4d02-ace3-3c1e52e2fb4b"/>'
                                data = data.replace(b'<Role schemeIdUri="urn:mpeg:dash:role:2011" value="main"/>',
                                                    clearkey_tag + b'\n      <Role schemeIdUri="urn:mpeg:dash:role:2011" value="main"/>')

                        self.send_response(resp.status)
                        self.send_header('Content-Type', 'application/dash+xml')
                        self.send_header('Content-Length', str(len(data)))
                        self.end_headers()
                        self.wfile.write(data)
                        return

                    # 2. Handle HLS M3U8 manifest (#EXTM3U)
                    is_iptv_playlist = (b'#EXTINF:-1' in data or b'group-title=' in data or b'#KODIPROP:' in data or b'tvg-name=' in data)
                    if (data.startswith(b'#EXTM3U') or 'mpegurl' in content_type.lower()) and not is_iptv_playlist:
                        text = data.decode('utf-8', errors='ignore')
                        rewritten_text = rewrite_m3u8(text, final_url, custom_ua, custom_ref)
                        rewritten_data = rewritten_text.encode('utf-8')

                        self.send_response(resp.status)
                        self.send_header('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8')
                        self.send_header('Content-Length', str(len(rewritten_data)))
                        self.end_headers()
                        self.wfile.write(rewritten_data)
                        return

                    # 3. Standard media files, keys, and stream chunks (.ts, .mp4, .key, etc.)
                    self.send_response(resp.status)
                    if content_type:
                        self.send_header('Content-Type', content_type)
                    if 'Content-Length' in resp.headers:
                        self.send_header('Content-Length', resp.headers['Content-Length'])
                    if 'Content-Range' in resp.headers:
                        self.send_header('Content-Range', resp.headers['Content-Range'])
                    self.send_header('Accept-Ranges', 'bytes')
                    self.end_headers()
                    self.wfile.write(data)

            except urllib.error.HTTPError as e:
                # If error response contains valid ClearKey JSON JWK
                try:
                    err_body = e.read()
                    if b'"keys"' in err_body:
                        self.send_response(200)
                        self.send_header('Content-Type', 'application/json')
                        self.send_header('Content-Length', str(len(err_body)))
                        self.end_headers()
                        self.wfile.write(err_body)
                        return
                except Exception:
                    pass

                self.send_response(e.code)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self.wfile.write(f'Upstream Error {e.code}: {e.reason}'.encode('utf-8'))
            except Exception as e:
                self.send_response(502)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self.wfile.write(f'Proxy Error: {str(e)}'.encode('utf-8'))
            return

        # For regular static files (HTML, CSS, JS, etc.)
        super().do_GET()


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def run():
    with ThreadingHTTPServer(("", PORT), IPTVProxyHandler) as httpd:
        print(f"Multi-threaded Server with OTT Navigator User-Agent Proxy running at http://localhost:{PORT}")
        httpd.serve_forever()


if __name__ == '__main__':
    run()
