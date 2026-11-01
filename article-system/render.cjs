const fs = require('fs');
const path = require('path');

module.exports = function buildArticles(source, output, options = {}) {
  const root = options.dataRoot || path.resolve(source, '..');
  const records = options.records || JSON.parse(fs.readFileSync(path.join(root, 'articles.json'), 'utf8'));
  const ids = records.map(article => article.id);
  const expected = Array.from({ length: 51 }, (_, index) => index + 1).filter(id => id !== 21 && id !== 22);
  if (records.length < 49 || new Set(ids).size !== records.length || ids.some(id => !Number.isSafeInteger(id) || id < 1 || id === 21 || id === 22) || expected.some(id => !ids.includes(id))) {
    throw new Error('The article collection must contain all 49 original IDs exactly once.');
  }
  const home = fs.readFileSync(path.join(source, 'index.html'), 'utf8');
  const escape = value => String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));

  function extractDiv(html, start) {
    let depth = 0;
    const tags = /<\/?div\b[^>]*>/g;
    tags.lastIndex = start;
    let match;
    while ((match = tags.exec(html))) {
      depth += match[0][1] === '/' ? -1 : 1;
      if (depth === 0) return html.slice(start, tags.lastIndex);
    }
    throw new Error('Unclosed shared header');
  }

  const header = extractDiv(home, home.indexOf('<div class="header">'))
    .replace(/class="desktop-nav-item active"/g, 'class="desktop-nav-item"')
    .replace('class="desktop-nav-item ftrde-articles-nav"', 'class="desktop-nav-item ftrde-articles-nav active"');
  const footerLinks = home.match(/<div class="footer-seo-links">([\s\S]*?)<\/div>/)[1];
  const copyright = home.match(/<div class="footer-copyright">([\s\S]*?)<\/div>/)[1];
  const bottomNavigation = home.match(/<div class="bottom-nav">([\s\S]*?)<\/div>/)[1]
    .replace(/class="bottom-nav-item active"/g, 'class="bottom-nav-item"');
  const categories = [['白号', 'baihao'], ['成品号', 'chengpinhao'], ['粉丝号', 'fensihao'],
    ['直播号', 'zhibohao'], ['等级号', 'kauishoudengjihao'], ['协议号', 'xieyihao']];
  const articlePath = article => '/article/' + article.id + '.html';
  const listPath = page => page === 1 ? '/article/list.html' : '/article/list-page-' + page + '.html';
  const breadcrumb = label => '<nav class="article-breadcrumb" aria-label="面包屑"><a href="/">首页</a><span>›</span>' + label + '</nav>';

  function shell(title, description, url, main, schema, article = false, pagination = '') {
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape(title) + ' - 飞拓星联</title>' +
      '<meta name="description" content="' + escape(description) + '">' +
      '<meta name="keywords" content="快手账号选购,快手商品资料,快手账号交付,飞拓星联">' +
      '<meta name="robots" content="index, follow"><meta name="googlebot" content="index, follow">' +
      '<link rel="canonical" href="https://ftrde.com' + url + '">' + pagination +
      '<meta property="og:type" content="' + (article ? 'article' : 'website') + '">' +
      '<meta property="og:title" content="' + escape(title) + '"><meta property="og:description" content="' + escape(description) + '">' +
      '<meta property="og:url" content="https://ftrde.com' + url + '">' +
      '<link rel="icon" type="image/svg+xml" href="/static/kuaishou/img/ftrde-favicon.svg">' +
      '<link rel="stylesheet" href="/_external/cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">' +
      '<link rel="stylesheet" href="/static/kuaishou/css/base.css"><link rel="stylesheet" href="/static/kuaishou/css/ftrde-theme.css">' +
      '<link rel="stylesheet" href="/assets/ftrde-articles.css">' +
      '<script type="application/ld+json">' + JSON.stringify(schema).replace(/</g, '\\u003c') + '</script></head>' +
      '<body><div class="app-container">' + header + '<main class="main-content ftrde-articles-main">' + main + '</main>' +
      '<div class="footer-seo"><div class="footer-seo-links">' + footerLinks + '</div><div class="footer-copyright">' + copyright +
      '</div></div><div class="bottom-nav">' + bottomNavigation + '</div></div></body></html>';
  }

  function inline(markdown) {
    const pattern = /\[([^\]\n]+)\]\(([^\s)]+)\)/g;
    let html = '', cursor = 0, match;
    while ((match = pattern.exec(markdown))) {
      const url = new URL(match[2], 'https://ftrde.com');
      if (url.origin !== 'https://ftrde.com') throw new Error('Unexpected article link: ' + match[2]);
      html += escape(markdown.slice(cursor, match.index)) + '<a href="' + escape(match[2]) + '">' + escape(match[1]) + '</a>';
      cursor = pattern.lastIndex;
    }
    return html + escape(markdown.slice(cursor));
  }

  function renderBody(article) {
    const markdown = fs.readFileSync(path.join(root, article.bodyFile), 'utf8').replace(/^\uFEFF/, '').trim();
    const firstBreak = markdown.indexOf('\n');
    if (markdown.slice(0, firstBreak).trim() !== '# ' + article.title) throw new Error('Article title mismatch: ' + article.id);
    return markdown.slice(firstBreak + 1).trim().split(/\r?\n\s*\r?\n/).map(block => {
      if (block.startsWith('## ')) return '<h2>' + inline(block.slice(3)) + '</h2>';
      if (/^#|<\/?[a-z]/i.test(block)) throw new Error('Unsupported article markup: ' + article.id);
      return '<p>' + inline(block) + '</p>';
    }).join('\n');
  }

  const pageSize = 10;
  const pageCount = Math.ceil(records.length / pageSize);
  const directory = path.join(output, 'article');
  fs.mkdirSync(directory, { recursive: true });
  for (let page = 1; page <= pageCount; page++) {
    const slice = records.slice((page - 1) * pageSize, page * pageSize);
    const cards = slice.map(article => '<article class="article-list-card"><span class="article-category">' + escape(article.category) +
      '</span><h2><a href="' + articlePath(article) + '">' + escape(article.title) + '</a></h2><p>' + escape(article.description) +
      '</p><a class="article-read" href="' + articlePath(article) + '">阅读全文 <span aria-hidden="true">→</span></a></article>').join('');
    const pagination = '<nav class="article-pagination" aria-label="文章列表分页">' +
      (page > 1 ? '<a href="' + listPath(page - 1) + '" rel="prev">上一页</a>' : '') +
      Array.from({ length: pageCount }, (_, index) => index + 1).map(index => index === page ?
        '<span aria-current="page" aria-label="第' + index + '页">' + index + '</span>' :
        '<a href="' + listPath(index) + '" aria-label="第' + index + '页">' + index + '</a>').join('') +
      (page < pageCount ? '<a href="' + listPath(page + 1) + '" rel="next">下一页</a>' : '') + '</nav>';
    const main = '<div class="article-container">' + breadcrumb('<span>文章列表' + (page > 1 ? ' · 第' + page + '页' : '') + '</span>') +
      '<header class="article-list-heading"><span class="article-eyebrow">飞拓星联 · 购买与内容指南</span><h1>文章列表</h1>' +
      '<p>了解账号类型、交付资料与订单处理，按实际用途做好选购和接收准备。</p></header>' +
      '<p class="article-list-count">共' + records.length + '篇文章 · 第' + page + ' / ' + pageCount + '页</p><div class="article-list-layout">' +
      '<section aria-label="文章目录"><div class="article-list">' + cards + '</div>' + pagination + '</section>' +
      '<aside class="article-sidebar"><h2>商品分类</h2><div>' + categories.map(([label, slug]) =>
        '<a href="/product/' + slug + '">快手' + label + '<span aria-hidden="true">›</span></a>').join('') +
      '</div><p>商品条件、价格和购买数量，以对应商品页显示为准。</p></aside></div></div>';
    const schema = { '@context': 'https://schema.org', '@type': 'ItemList', name: '飞拓星联文章列表 · 第' + page + '页',
      numberOfItems: slice.length, itemListElement: slice.map((article, index) => ({ '@type': 'ListItem',
        position: (page - 1) * pageSize + index + 1, name: article.title, url: 'https://ftrde.com' + articlePath(article) })) };
    const headPagination = (page > 1 ? '<link rel="prev" href="https://ftrde.com' + listPath(page - 1) + '">' : '') +
      (page < pageCount ? '<link rel="next" href="https://ftrde.com' + listPath(page + 1) + '">' : '');
    const title = page === 1 ? '文章列表' : '文章列表 · 第' + page + '页';
    const description = page === 1 ? '飞拓星联快手账号选购与交付指南，介绍商品类型、资料格式、验收和订单问题。' :
      '飞拓星联文章列表第' + page + '页，阅读快手账号选购、资料验收与内容准备指南。';
    fs.writeFileSync(path.join(output, listPath(page)), shell(title, description, listPath(page), main, schema, false, headPagination));
  }

  for (const [index, article] of records.entries()) {
    const url = articlePath(article);
    const body = renderBody(article);
    const date = article.modifiedDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < article.publishedDate) throw new Error('Invalid article date');
    const schema = { '@context': 'https://schema.org', '@type': 'Article', headline: article.title, description: article.description,
      mainEntityOfPage: 'https://ftrde.com' + url, datePublished: article.publishedDate, dateModified: date,
      publisher: { '@type': 'Organization', name: '飞拓星联', url: 'https://ftrde.com',
        logo: { '@type': 'ImageObject', url: 'https://ftrde.com/static/kuaishou/img/ftrde-brand-logo.svg' } } };
    const relatedCategory = article.category === '生活与创作' ? '内容与经营' : article.category;
    const related = records.filter(item => item.id !== article.id).sort((left, right) =>
      Number(right.category === relatedCategory) - Number(left.category === relatedCategory)).slice(0, 3);
    const relatedHtml = '<section class="article-related" aria-labelledby="related-heading"><h2 id="related-heading">继续阅读</h2><ul>' +
      related.map(item => '<li><a href="' + articlePath(item) + '">' + escape(item.title) + '</a></li>').join('') + '</ul></section>';
    const neighbours = '<nav class="article-neighbours" aria-label="上下篇文章">' +
      (index > 0 ? '<a href="' + articlePath(records[index - 1]) + '" rel="prev"><span>上一篇</span>' + escape(records[index - 1].title) + '</a>' : '') +
      (index < records.length - 1 ? '<a href="' + articlePath(records[index + 1]) + '" rel="next"><span>下一篇</span>' + escape(records[index + 1].title) + '</a>' : '') + '</nav>';
    const main = '<div class="article-container article-detail-container">' +
      breadcrumb('<a href="/article/list.html">文章列表</a><span>›</span><span>正文</span>') +
      '<article class="article-detail"><header class="article-detail-heading"><span class="article-category">' + escape(article.category) +
      '</span><h1>' + escape(article.title) + '</h1><p class="article-date">更新日期：<time datetime="' + date + '">' + date +
      '</time></p><p class="article-intro">' + escape(article.description) + '</p></header><div class="article-content">' + body + '</div>' +
      relatedHtml + neighbours + '<footer class="article-actions"><a href="' + listPath(Math.floor(index / pageSize) + 1) +
      '">← 返回文章列表</a><a href="/product">查看商品 →</a></footer></article></div>';
    fs.writeFileSync(path.join(output, url), shell(article.title, article.description, url, main, schema, true));
  }
  return { articles: records.length, listPages: pageCount, pages: records.length + pageCount };
};
