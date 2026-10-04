# Point hookrz.fun at the site (Namecheap → Domain List → hookrz.fun → Advanced DNS)

The site is served by GitHub Pages from the repo PatanL/hookrz (custom domain hookrz.fun is already set on the repo).

## Host Records
1. **Remove** both existing records:
   - `CNAME Record` · Host `www` · Value `parkingpage.namecheap.com.`
   - `URL Redirect Record` · Host `@` · Value `http://www.hookrz.fun/`
2. **Add** these records (TTL: Automatic):

| Type | Host | Value |
|---|---|---|
| A Record | @ | 185.199.108.153 |
| A Record | @ | 185.199.109.153 |
| A Record | @ | 185.199.110.153 |
| A Record | @ | 185.199.111.153 |
| CNAME Record | www | patanl.github.io. |

Optional IPv6 (AAAA Record, Host @): 2606:50c0:8000::153, 2606:50c0:8001::153, 2606:50c0:8002::153, 2606:50c0:8003::153

3. Leave **Mail Settings** (Email Forwarding, its TXT SPF record) as they are.
4. Save all changes (the green check on each row).

## After saving
- DNS takes 5–30 minutes. Check with `dig +short hookrz.fun` → the four 185.199.x.153 addresses.
- GitHub then issues the HTTPS certificate automatically (up to ~1 hour). Then in GitHub → PatanL/hookrz →
  Settings → Pages, tick **Enforce HTTPS** (Claude can do this step from the CLI once the cert exists).
