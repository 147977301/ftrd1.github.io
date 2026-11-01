'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const dataRoot = path.join(root, 'article-data');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const readCatalog = () => JSON.parse(fs.readFileSync(path.join(dataRoot, 'articles.json'), 'utf8'));
const normalize = text => String(text).replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
function similarity(a, b) {
  const pairs = text => new Set(Array.from({length: Math.max(0, text.length - 1)}, (_, i) => text.slice(i, i + 2)));
  const x = pairs(normalize(a)), y = pairs(normalize(b));
  if (!x.size || !y.size) return normalize(a) === normalize(b) ? 1 : 0;
  return 2 * [...x].filter(item => y.has(item)).length / (x.size + y.size);
}
function validateArticle(article, catalog = readCatalog()) {
  if (!article || !['title','description','category','bodyMarkdown'].every(key => typeof article[key] === 'string')) throw Error('文章字段不完整。');
  const categories = [...new Set(catalog.map(item => item.category))];
  if (article.title.length < 8 || article.title.length > 60 || /[\r\n<>]/.test(article.title)) throw Error('标题格式不合适。');
  if (article.description.length < 20 || article.description.length > 180 || /[\r\n<>]/.test(article.description)) throw Error('文章介绍需为20—180字的一段文字。');
  if (!categories.includes(article.category)) throw Error('文章分类无效。');
  const body = article.bodyMarkdown.trim();
  const length = body.replace(/^## /gm, '').replace(/\s/g, '').length;
  if (length < config.minCharacters || length > config.maxCharacters) throw Error('正文长度不在约定范围内，请调整后重新生成。');
  if (/<\/?[a-z!]|```|^#(?!# )|^###|!\[|\]\(|^\s*[-*+]\s|^\s*\d+[.)、]\s|^\|/im.test(body)) throw Error('正文只能含自然段和二级标题。');
  if (/小红书|vxvo88|sanpinche|zayng\.com|百分百|100%|永不封|稳赚|保证.{0,6}(?:排名|收录|收益)/i.test(body)) throw Error('正文含旧平台信息或不当承诺，请修改。');
  if (catalog.some(item => normalize(item.title) === normalize(article.title) || similarity(item.title, article.title) >= .88)) throw Error('标题与已有文章过于相似，请换一个具体切入点。');
  if (/\d+(?:[—-]\d+)?\s*元|人民币/.test(body)) throw Error('正文出现人民币价格，请按本站美元资料核对。');
  const mentions = [...body.matchAll(/\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*美元|USD\s*(\d+(?:\.\d+)?)/gi)].map(match=>Number(match[1]||match[2]||match[3]));
  if (mentions.length) {const allowed=new Set(productFacts().map(item=>Number(item.price)));if(mentions.some(price=>!allowed.has(price)))throw Error('正文含未出现在商品资料中的美元报价，请核对。');}
  const paragraphs = body.split(/\r?\n\s*\r?\n/).filter(block => !block.startsWith('## '));
  if (paragraphs.length < 8) throw Error('正文展开不足，请按完整文章写作。');
  const oldParagraphs = new Set(catalog.flatMap(item => fs.readFileSync(path.join(dataRoot, item.bodyFile), 'utf8').split(/\r?\n\s*\r?\n/)).filter(text => text.length >= 65).map(normalize));
  const seen = new Set();
  for (const paragraph of paragraphs) {
    const text = normalize(paragraph);
    if (paragraph.length >= 65 && (oldParagraphs.has(text) || seen.has(text))) throw Error('正文含重复长段，请换一个切入点或修改草稿。');
    seen.add(text);
  }
  return {...article, bodyMarkdown: body};
}
function productFacts() {
  return fs.readdirSync(path.join(root, 'detail')).filter(file => file.endsWith('.html')).map(file => {
    const html = fs.readFileSync(path.join(root, 'detail', file), 'utf8');
    const objects = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].map(match => JSON.parse(match[1]));
    const product = objects.find(object => object['@type'] === 'Product');
    if (!product) throw Error('商品结构化资料缺失。');
    return {name: product.name, price: product.offers.price, currency: product.offers.priceCurrency};
  });
}
async function generateArticle(topic, {fetcher = fetch, apiKey = process.env.OPENAI_API_KEY} = {}) {
  topic = String(topic || '').trim();
  if (topic.length < 6 || topic.length > 180 || /[\r\n]/.test(topic)) throw Error('请填写6—180字的具体选题。');
  if (!apiKey) throw Error('未找到OPENAI_API_KEY。请在仓库Actions Secrets中添加。');
  const catalog = readCatalog();
  if (catalog.some(item => normalize(item.title) === normalize(topic))) throw Error('该标题已经存在，请换一个选题。');
  const properties = {title:{type:'string'},description:{type:'string'},category:{type:'string',enum:[...new Set(catalog.map(item => item.category))]},bodyMarkdown:{type:'string'}};
  const instructions = fs.readFileSync(path.join(__dirname, 'instructions.txt'), 'utf8').replace(/^\uFEFF/, '') + '\n正文去空白后需' + config.minCharacters + '—' + config.maxCharacters + '字。';
  const response = await fetcher('https://api.openai.com/v1/responses', {
    method: 'POST', headers: {'Authorization':'Bearer ' + apiKey,'Content-Type':'application/json'}, signal: AbortSignal.timeout(180000),
    body: JSON.stringify({model:process.env.OPENAI_MODEL || config.model,store:false,max_output_tokens:config.maxOutputTokens,reasoning:{effort:'low'},instructions,
      input: JSON.stringify({topic,site:config.brand,products:productFacts(),existingArticles:catalog.map(item=>({title:item.title,description:item.description})),styleExample:fs.readFileSync(path.join(dataRoot,'articles/51.md'),'utf8')}),
      text:{format:{type:'json_schema',name:'article_draft',strict:true,schema:{type:'object',properties,required:Object.keys(properties),additionalProperties:false}}}})
  });
  if (!response.ok) {
    const reasons={401:'密钥无效或已撤销',403:'账号、项目或模型权限不足',404:'当前项目无法使用所选模型',429:'额度不足或达到速率限制'};
    throw Error('OpenAI请求失败（HTTP '+response.status+'）：'+(reasons[response.status]||'请稍后检查接口服务')+'。本次不发布文章。');
  }
  const payload = await response.json();
  if (payload.status !== 'completed') throw Error('生成未完整完成，本次不保存或发布，请检查额度及输出限制。');
  const content = (payload.output || []).flatMap(item => item.content || []);
  if (content.some(item => item.type === 'refusal')) throw Error('模型没有生成该选题，请调整选题。');
  const text = content.filter(item => item.type === 'output_text').map(item => item.text).join('');
  let article;try {article=JSON.parse(text);} catch {throw Error('接口未返回完整文章格式，本次不发布。');}
  return {article:validateArticle(article,catalog),usage:payload.usage || null,model:payload.model || config.model};
}
function saveDraft(result) {
  const catalog = readCatalog(), article = result.article;
  if(process.env.RUNNER_TEMP) fs.writeFileSync(path.join(process.env.RUNNER_TEMP,'ftrde-generated-draft.json'),JSON.stringify(article,null,2));
  const id = Math.max(...catalog.map(item=>item.id)) + 1;
  const bodyFile = 'articles/' + id + '.md';
  const file = path.join(dataRoot, bodyFile);
  if (fs.existsSync(file)) throw Error('文章编号已占用，本次停止。');
  fs.writeFileSync(file, '# ' + article.title + '\n\n' + article.bodyMarkdown + '\n');
  catalog.unshift({id,title:article.title,description:article.description,category:article.category,bodyFile,publishedDate:null,modifiedDate:null});
  fs.writeFileSync(path.join(dataRoot,'articles.json'), JSON.stringify(catalog,null,2)+'\n');
  return {id,file:bodyFile,title:article.title};
}
function git(args) {return execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
async function requestReview(info) {
  const token = process.env.GH_TOKEN, repo = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID, attempt = process.env.GITHUB_RUN_ATTEMPT || '1';
  if (!token || !/^\d+$/.test(runId || '') || !/^[\w.-]+\/[\w.-]+$/.test(repo || '')) throw Error('请从GitHub Actions运行此步骤。');
  const branch='article-draft/'+runId+'-'+attempt;
  git(['config','user.name','github-actions[bot]']);git(['config','user.email','41898282+github-actions[bot]@users.noreply.github.com']);
  git(['checkout','-b',branch]);git(['add','--','article-data/articles.json','article-data/'+info.file]);
  git(['commit','-m','新增文章草稿 #'+info.id]);git(['push','origin','HEAD:refs/heads/'+branch]);
  const compare='https://github.com/'+repo+'/compare/main...'+branch+'?expand=1';
  let reviewUrl=compare, autoPr=false;
  let response;try {response=await fetch('https://api.github.com/repos/'+repo+'/pulls',{method:'POST',headers:{Authorization:'Bearer '+token,'User-Agent':'ftrde-article-workflow','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},body:JSON.stringify({title:'文章草稿：'+info.title,head:branch,base:'main',body:'新增第'+info.id+'篇文章。\n\n请先阅读 article-data/'+info.file+'，按需要修改后再合并。合并会触发网站构建和发布。\n\n自动检查覆盖格式、长度、旧平台字样和部分重复，不代表事实与原创性已经全部核实。商品、收款及现有文章正文不在本次修改范围。'})});}catch {response=null;}
  if(response?.ok){const pr=await response.json();reviewUrl=pr.html_url;autoPr=true;}
  const summary='## 草稿已生成，尚未发布\n\n- 文章编号：'+info.id+'\n- [阅读完整草稿](https://github.com/'+repo+'/blob/'+branch+'/article-data/'+info.file+')\n- [打开审核页面]('+reviewUrl+')\n\n'+(autoPr?'阅读并修改后，点击 Merge pull request 合并，网站会自动更新。':'仓库暂未允许自动创建Pull Request。草稿已保存在独立分支；点击审核页面，再点击 Create pull request 创建审核，确认后合并。无需重新调用AI。')+'\n';
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
  console.log('草稿 #'+info.id+' 已保存至审核分支，尚未发布。');
}
module.exports={validateArticle,generateArticle,saveDraft,similarity,productFacts};
if(require.main===module)(async()=>{
  if(process.env.GITHUB_REF!=='refs/heads/main')throw Error('请在main分支运行写稿流程。');
  const result=await generateArticle(process.env.ARTICLE_TOPIC);
  const info=saveDraft(result);
  await requestReview(info);
})().catch(error=>{console.error(error.name==='TimeoutError'?'请求超时，本次未发布。':error.message);process.exitCode=1;});
