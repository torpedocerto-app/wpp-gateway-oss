import type { MetadataRoute } from 'next';

/**
 * Bloqueia indexação de TODO o deploy — default deliberadamente conservador.
 *
 * O painel exige sessão, mas `/login` e `/docs/api` respondem sem autenticação,
 * e a página de docs é rica em texto. Indexada, ela permite que uma busca liste
 * todos os deploys deste gateway, o que é informação de infraestrutura que a
 * maioria dos operadores não quer pública. A documentação continua acessível
 * para quem tem o link; só não é descoberta por buscador.
 *
 * Se o seu deploy é uma demo e você QUER que seja encontrada, troque o
 * `disallow` por `allow: '/docs'` e remova o `robots: noindex` de
 * `app/docs/layout.tsx` — são duas camadas independentes.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', disallow: '/' }],
  };
}
