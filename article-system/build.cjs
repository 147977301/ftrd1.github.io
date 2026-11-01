'use strict';
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');
const render = require('./render.cjs');
const sitemap = require('./sitemap.cjs');
const allowedDirectories = ['_external','assets','article','detail','order','product','static'];
const allowedFiles = ['.nojekyll','CNAME','_headers','_redirects','index.html','robots.txt','sitemap.xml'];
function shanghaiDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw Error('日期格式无效。');
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  return ['year','month','day'].map(key=>parts.find(item=>item.type===key).value).join('-');
}
function gitDates(root, bodyFile) {
  const file = 'article-data/' + bodyFile;
  const command = args => execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const added = command(['log','--first-parent','--diff-merges=first-parent','--no-patch','--diff-filter=A','--format=%cI','--',file]).split('\n').filter(Boolean);
  const latest = command(['log','--first-parent','--diff-merges=first-parent','--no-patch','-1','--format=%cI','--',file]);
  if (!added.length || !latest) throw Error('新文章必须先确认合并到main，才能确定正式日期。');
  return {publishedDate:shanghaiDate(added.at(-1)),modifiedDate:shanghaiDate(latest)};
}
function build(root = path.resolve(__dirname,'..'), {dateResolver = gitDates} = {}) {
  const output = path.join(root,'.pages');
  if (fs.existsSync(output)) throw Error('.pages目录已存在，请使用干净的构建目录，避免混入旧文件。');
  if (fs.readFileSync(path.join(root,'CNAME'),'utf8').trim() !== 'ftrde.com') throw Error('域名与本系统不一致，停止构建。');
  const dataRoot = path.join(root,'article-data');
  const catalog = JSON.parse(fs.readFileSync(path.join(dataRoot,'articles.json'),'utf8'));
  const today = shanghaiDate(new Date());
  const records = catalog.map(article => {
    if (!Number.isSafeInteger(article.id) || article.bodyFile !== 'articles/'+article.id+'.md') throw Error('文章路径或编号不正确。');
    const dates = article.publishedDate && article.modifiedDate ? article : dateResolver(root,article.bodyFile);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dates.publishedDate) || dates.modifiedDate < dates.publishedDate || dates.modifiedDate > today) throw Error('文章日期无效。');
    return {...article,publishedDate:dates.publishedDate,modifiedDate:dates.modifiedDate};
  }).sort((a,b)=>b.id-a.id);
  function copy(from,to) {
    const stat = fs.lstatSync(from);
    if (stat.isSymbolicLink()) throw Error('不复制符号链接。');
    if (stat.isDirectory()) {fs.mkdirSync(to,{recursive:true});for(const name of fs.readdirSync(from))copy(path.join(from,name),path.join(to,name));}
    else {fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);}
  }
  fs.mkdirSync(output);
  for(const file of [...allowedFiles,...allowedDirectories]){
    const from=path.join(root,file);if(fs.existsSync(from))copy(from,path.join(output,file));
  }
  // The renderer owns article pages; do not remove unrelated product or asset files.
  for(const file of fs.readdirSync(path.join(output,'article'))){
    if(/^\d+\.html$|^list(?:-page-\d+)?\.html$/.test(file))fs.unlinkSync(path.join(output,'article',file));
  }
  const result = render(output,output,{dataRoot,records});
  fs.writeFileSync(path.join(output,'sitemap.xml'),sitemap(output));
  for(const forbidden of ['article-system','article-data','.git','.github'])if(fs.existsSync(path.join(output,forbidden)))throw Error('构建产物混入开发文件。');
  return {...result,output,sitemapUrls:(fs.readFileSync(path.join(output,'sitemap.xml'),'utf8').match(/<loc>/g)||[]).length};
}
module.exports = {build,shanghaiDate,gitDates};
if(require.main===module){try{
  if(process.env.GITHUB_ACTIONS==='true' && process.env.GITHUB_REF!=='refs/heads/main')throw Error('仅允许从main发布。');
  console.log(JSON.stringify(build()));
}catch(error){console.error(error.message);process.exitCode=1;}}
