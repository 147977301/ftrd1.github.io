'use strict';
const fs=require('fs'),path=require('path');
const {validateArticle,saveDraft}=require('./generate.cjs');
function prepare(payload){
 const article=validateArticle(payload.article);
 if(!Array.isArray(payload.sources)||payload.sources.length<1||payload.sources.length>5)throw Error('本地稿件需附1—5条已核对的官方来源。');
 const sources=payload.sources.map(item=>{const url=new URL(item.url);if(url.protocol!=='https:'||url.hostname!=='www.kuaishou.com'||!/^\/help\/feedback\/\d+$/.test(url.pathname))throw Error('来源须为已核对的快手官方帮助页面。');if(typeof item.title!=='string'||item.title.length>100)throw Error('来源标题不正确。');return {title:item.title,url:url.href,publisher:'快手帮助中心'};});
 const info=saveDraft({article});
 const file=path.resolve(__dirname,'../article-data/articles.json'),catalog=JSON.parse(fs.readFileSync(file,'utf8'));
 Object.assign(catalog.find(item=>item.id===info.id),{sources,writingMethod:'Codex本地任务'});
 fs.writeFileSync(file,JSON.stringify(catalog,null,2)+'\n');
 return {...info,characters:article.bodyMarkdown.replace(/\s/g,'').length,sourceCount:sources.length};
}
module.exports={prepare};
if(require.main===module){try{if(process.argv.length!==3)throw Error('请提供Codex已写好的稿件JSON文件；本程序不调用API。');const payload=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));console.log(JSON.stringify(prepare(payload)));}catch(error){console.error(error.message);process.exitCode=1;}}
