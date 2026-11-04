'use strict';
/*
 * ====================================================================
 *  PONTO DE INTEGRAÇÃO — DOWNLOAD DO .EXE (Windows)
 * ====================================================================
 *  O servidor (server.js) chama resolveExe() SÓ DEPOIS que o Stripe confirmou o
 *  pagamento. Esta é a única função que precisa mudar para ligar o seu .exe.
 *  Não mexa na verificação do Stripe nem em server.js.
 *
 *  O que retornar:
 *    { type: 'file', path: '/caminho/absoluto/Jogo.exe', name: 'Jogo.exe' }  -> o servidor envia o arquivo
 *    { type: 'redirect', url: 'https://...' }                                -> o navegador é levado a esse link
 *    null                                                                    -> .exe indisponível (a página avisa)
 *
 *  O que recebe (ctx):
 *    ctx.session        sessão do Stripe já verificada (paga). Ex.: ctx.session.id, ctx.session.customer_details
 *    ctx.env            variáveis do .env
 *    ctx.downloadsDir   caminho absoluto da pasta downloads/
 *    ctx.localFile(ext) acha o primeiro arquivo com essa extensão em downloads/  -> { name, full } | null
 *
 *  JÁ FUNCIONA SEM EDITAR (escolha uma das duas formas):
 *    A) Arquivo no servidor: coloque o .exe dentro da pasta downloads/ (qualquer nome terminado em .exe).
 *    B) Link externo: ponha EXE_URL=https://... no .env (link DIRETO do arquivo: GitHub Releases, S3, R2, etc.).
 *
 *  PARA O CHATGPT (ou qualquer pessoa) COMPLETAR: se o seu .exe fica num serviço que exige link assinado/temporário
 *  (S3, Cloudflare R2, Google Cloud Storage...), gere o link aqui dentro e retorne { type: 'redirect', url }.
 *  Veja o exemplo comentado no fim deste arquivo. Mantenha o link válido só por alguns minutos.
 * ====================================================================
 */
module.exports = async function resolveExe(ctx) {
  // B) link externo direto definido no .env
  const url = ctx.env.EXE_URL;
  if (url) {
    if (!/^https:\/\//i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(url)) return null; // só https (ou localhost p/ teste)
    return { type: 'redirect', url };
  }

  // A) arquivo na pasta downloads/
  const f = ctx.localFile('exe');
  if (f) return { type: 'file', path: f.full, name: f.name };

  // >>> COLE AQUI o código do seu provedor de arquivos (veja o exemplo abaixo) <<<
  return null;
};

/*
 * EXEMPLO (NÃO está ativo) — link assinado do S3 com o SDK da AWS (npm i @aws-sdk/client-s3 @aws-sdk/s3-request-presigner):
 *
 *   const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
 *   const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
 *   const s3 = new S3Client({ region: ctx.env.AWS_REGION });
 *   const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: ctx.env.S3_BUCKET, Key: 'VidaLoka.exe',
 *     ResponseContentDisposition: 'attachment; filename="VidaLoka.exe"' }), { expiresIn: 300 });
 *   return { type: 'redirect', url };
 */
