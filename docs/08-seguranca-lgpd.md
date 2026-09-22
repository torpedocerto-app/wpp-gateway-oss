# 08 — Segurança e LGPD

---

## 1. Superfície de ataque

| Componente | Exposição | Proteção |
|---|---|---|
| API pública `/v1/*` | Internet | Token Bearer, rate-limit, TLS |
| Painel admin | Internet | Senha + 2FA, sessão curta, IP allowlist opcional |
| Postgres | Rede interna Docker | Sem porta publicada, senha forte |
| Redis | Rede interna Docker | Sem porta publicada, `requirepass` |
| Worker | Sem porta HTTP | Não exposto |
| Sessões WhatsApp | Filesystem (EBS) | Permissão 0700, EBS criptografado |
| Acesso à EC2 | **Porta 22 fechada** | SSM Session Manager, auditado no CloudTrail |
| Pipeline de deploy | GitHub Actions | OIDC com credencial temporária, sem access key |

> **Regra de exposição:** apenas as portas 80/443 do reverse proxy são publicadas.
> Postgres e Redis **nunca** têm `ports:` no docker-compose — apenas `expose:`.
> Publicar 5432 num IP público é convite a varredura automatizada.

---

## 2. Autenticação da API

- Token: `mk_live_<32 bytes base62>` gerado com `crypto.randomBytes` (CSPRNG)
- Armazenado como **SHA-256**; o valor em claro existe só no momento da criação
- Comparação em **tempo constante** para evitar timing attack
- Cache de validação em Redis (60 s) para não bater no banco a cada request
- Revogação é imediata: invalida o cache junto

**Rotação recomendada:** criar novo token → atualizar o projeto → revogar o antigo.
Múltiplos tokens ativos por projeto existem exatamente para permitir rotação sem downtime.

---

## 3. Autenticação do painel

Multi-usuário por tenant: N linhas em `admin_users` (cada tenant tem seu Postgres
isolado — sem usuários cross-tenant). Gestão na tela **Usuários** do painel
(convidar, desativar, remover, trocar a própria senha).

| Item | Implementação |
|---|---|
| Login | E-mail + senha + TOTP (os três) |
| Senha | Argon2id (`memoryCost` 19 MiB, `timeCost` 2); mínimo 12 caracteres |
| 2FA | TOTP obrigatório, provisionado no primeiro acesso de cada usuário |
| Sessão | Cookie `httpOnly` + `Secure` + `SameSite=Strict`, HMAC-SHA256, 8 h |
| Revogação | `requireSession` recarrega o usuário a cada request protegido: removido/desativado → sessão encerrada no próximo acesso (lazy; não há tabela de sessões p/ kill imediato entre dispositivos) |
| Brute force | Janela fixa in-process: `/login` 10/5 min por IP, `/login/forgot` 5/15 min por IP (reseta a cada restart do container; Redis seria o upgrade) |
| CSRF | `SameSite=Strict` nas Server Actions |

### 3.1 Recuperação e convite

- **Esqueci a senha** (`/login/forgot`): gera token de uso único, sha256 na tabela
  `admin_tokens` (`purpose=RESET`, TTL 30 min), link por email. Resposta é sempre
  genérica ("se o e-mail existir…") — não revela quais e-mails existem. Só o link
  mais recente vale; throttle de 60 s entre pedidos. Reset **não** mexe no 2FA.
- **Convite** (tela Usuários): cria a linha `SETUP_PENDING`, token `purpose=INVITE`
  (TTL 72 h), link `/login/setup?token=…` onde o convidado define senha + 2FA.
- **Break-glass sem SMTP**: `scripts/admin-create.sh` (1º usuário do tenant) e
  `scripts/admin-reset.sh` (reset de um usuário) — rodam na EC2, imprimem o link
  de setup direto.

---

## 4. Criptografia

### 4.1 Em trânsito
- TLS 1.3 obrigatório, HSTS habilitado, redirect 80→443
- Webhooks só para URLs `https://`

### 4.2 Em repouso

| Dado | Método |
|---|---|
| Credenciais de sessão WhatsApp | EBS criptografado (KMS) + permissão 0700 no diretório |
| `webhook_secret` | AES-256-GCM, chave vinda do Secrets Manager |
| `totp_secret` | AES-256-GCM |
| Senhas | Argon2id (hash, não criptografia) |
| Tokens de API | SHA-256 (hash) |
| Backups em S3 | SSE-S3 (AES-256) no bucket |

**Chave mestra (`ENCRYPTION_KEY`)** no AWS Secrets Manager, nunca no repositório.

> 🔴 **Guarde uma cópia em gerenciador de senhas externo.** Se o Secrets Manager for
> apagado por engano, as sessões WhatsApp e os secrets de webhook tornam-se
> irrecuperáveis — o backup do banco não resolve, porque os dados estão cifrados
> com essa chave.

---

## 5. Segurança dos webhooks

**Ao emitir** (nós → projeto): HMAC-SHA256 com timestamp, timeout 10 s, sem seguir
redirects, apenas HTTPS.

**Proteção contra SSRF:** a `webhook_url` é validada no cadastro e **resolvida antes
de cada chamada**, rejeitando IPs privados (`10.x`, `172.16-31.x`, `192.168.x`,
`127.x`, `169.254.x`) e `localhost`.

> Validar apenas no cadastro é insuficiente: um domínio pode apontar para IP público
> no momento do cadastro e ser reapontado para `169.254.169.254` (metadata da cloud)
> depois. A resolução precisa acontecer no momento da requisição.

---

## 6. LGPD

### 6.1 Papéis

Por deploy (cada instância white-label serve uma organização):

- **A organização que opera o deploy:** Controladora — define finalidade e meios
- **wpp-gateway (esta instância):** Operador — trata em nome da controladora
- **Projetos consumidores:** responsáveis pela base legal de cada envio

### 6.2 Dados pessoais tratados

| Dado | Categoria | Retenção |
|---|---|---|
| Telefone do destinatário | Identificação | 90 dias |
| Conteúdo das mensagens | Pode conter dado sensível | 90 dias |
| Telefones das contas do pool | Identificação | Enquanto ativa |
| Metadados (horários, status) | Comportamental | 90 dias detalhado, agregado depois |

### 6.3 Princípios aplicados

| Princípio | Implementação |
|---|---|
| **Finalidade** | Só comunicação transacional autorizada pela holding |
| **Necessidade** | Não armazena mídia, contatos ou histórico além do enviado/recebido |
| **Transparência** | Mensagens identificam o remetente |
| **Segurança** | Criptografia em repouso e em trânsito |
| **Não discriminação** | Sem profiling ou decisão automatizada sobre titulares |

### 6.4 Direitos do titular

| Direito | Como atender |
|---|---|
| Confirmação e acesso | Busca por número em `/messages` |
| Correção | Não aplicável (dado transacional imutável) |
| **Eliminação** | Endpoint interno `DELETE /admin/data/{phone}` remove todo o histórico |
| Portabilidade | Export em JSON/CSV pelo painel |
| **Oposição** | Blocklist global de opt-out (Fase 2) |

### 6.5 Base legal

Definida por cada projeto consumidor. Para transacional, normalmente **execução de
contrato** (art. 7º, V) ou **legítimo interesse** (art. 7º, IX). Comunicação de
marketing exige **consentimento** (art. 7º, I).

> **Documente a base legal por projeto** no campo de descrição em `/projects`.
> Em caso de fiscalização, é a primeira pergunta.

### 6.6 Incidente de segurança

1. Conter (revogar tokens, isolar componente)
2. Avaliar risco aos titulares
3. Comunicar a controladora em até 24 h
4. Comunicar ANPD e titulares se houver risco relevante (prazo razoável, ~2 dias úteis)
5. Registrar em relatório de incidente

---

## 7. Auditoria

**Registrar sempre:** login (sucesso e falha) · criação/revogação de token · adição
e remoção de conta · alteração de limites · acesso a conteúdo de mensagens ·
exclusão de dados por solicitação de titular

Logs por 1 ano, imutáveis (append-only), sem conteúdo de mensagem.

**Nunca logar:** conteúdo de mensagens em nível `info` · tokens completos ·
credenciais de sessão · senhas. O logger deve ter **redaction configurada** para
`authorization`, `token`, `password`, `secret`.

---

## 8. Checklist pré-produção

- [ ] TLS válido com renovação automática
- [ ] Portas de Postgres e Redis **não** publicadas
- [ ] `ENCRYPTION_KEY` gerada, fora do repositório, com cópia no cofre de senhas
- [ ] 2FA ativo no painel
- [ ] Rate-limit testado
- [ ] Validação SSRF de webhook testada
- [ ] Backup executado **e restauração testada**
- [ ] Redaction de logs verificada
- [ ] `.env` no `.gitignore`
- [ ] **Security Group permitindo apenas 80 e 443 — porta 22 fechada**
- [ ] Acesso administrativo via SSM Session Manager (sem SSH, sem chave privada)
- [ ] IMDSv2 obrigatório na EC2 (`HttpTokens=required`)
- [ ] EBS criptografado com `DeleteOnTermination=false`
- [ ] Secrets no AWS Secrets Manager, não em `.env` versionado
- [ ] Bucket S3 de backup com bloqueio público, versionamento e criptografia
- [ ] Deploy via OIDC (sem access key da AWS no GitHub Secrets)
