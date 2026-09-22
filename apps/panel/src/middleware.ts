import { NextRequest, NextResponse } from 'next/server';

/**
 * Middleware: redireciona rotas protegidas para /login se não há cookie de
 * sessão. A validação real da sessão acontece no `requireSession` server-side.
 *
 * NÃO usa `createMiddleware` do next-intl aqui: no modo sem prefixo de locale
 * ('never'), esse middleware reescreve toda rota internamente para
 * `/${locale}${pathname}` (ex.: `/login` → `/pt/login`) e exige que as páginas
 * do App Router vivam sob `app/[locale]/...` — não é o caso deste projeto
 * (rotas ficam direto em `app/login/...`), e o rewrite batia em uma rota
 * inexistente → 404 em TODAS as páginas (incidente de 2026-09-11).
 *
 * O locale é resolvido sem depender de nenhum header de middleware:
 * `apps/panel/src/i18n/request.ts` já lê o cookie `NEXT_LOCALE` e o
 * `Accept-Language` diretamente a cada request (doc 12).
 *
 * Roda no Edge Runtime; não pode usar node:crypto nem Prisma.
 */
// /docs/api é a documentação de integração pública (doc 03) — sem login,
// pra devs/IAs de terceiros consumirem sem precisar de sessão no painel.
const PUBLIC_PATHS = ['/login', '/docs'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  if (!isPublic && !req.cookies.has('wpp_session')) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // robots.txt fica de fora: interceptado pelo middleware ele redirecionava
  // para /login, e o crawler nunca via a diretiva de bloqueio.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
};
