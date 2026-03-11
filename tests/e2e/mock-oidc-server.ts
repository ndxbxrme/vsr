import { createServer } from 'node:http';

const port = Number(process.env.OIDC_MOCK_PORT ?? '4323');

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);

  if (url.pathname === '/authorize') {
    const redirectUri = url.searchParams.get('redirect_uri');
    const state = url.searchParams.get('state');
    if (!redirectUri || !state) {
      res.writeHead(400).end('missing_redirect');
      return;
    }

    const redirectUrl = new URL(redirectUri);
    redirectUrl.searchParams.set('code', 'playwright-google-code');
    redirectUrl.searchParams.set('state', state);
    res.writeHead(302, {
      Location: redirectUrl.toString(),
    });
    res.end();
    return;
  }

  if (url.pathname === '/token') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
    });
    res.end(
      JSON.stringify({
        access_token: 'playwright-google-access-token',
        refresh_token: 'playwright-google-refresh-token',
        expires_in: 3600,
      }),
    );
    return;
  }

  if (url.pathname === '/userinfo') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
    });
    res.end(
      JSON.stringify({
        sub: 'playwright-google-user',
        email: 'playwright-oauth@example.com',
        given_name: 'Playwright',
        family_name: 'OAuth',
        name: 'Playwright OAuth',
      }),
    );
    return;
  }

  res.writeHead(404).end('not_found');
}).listen(port, '127.0.0.1', () => {
  console.log(`mock oidc server listening on ${port}`);
});
