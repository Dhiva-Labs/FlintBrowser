'use strict';

// Reader mode: run Mozilla Readability inside the page, cache the extracted
// article and show it on flint://reader. The reader page has a strict CSP so
// article HTML cannot execute scripts.

const fs = require('fs');

let readabilitySrc = null;
function getReadabilitySource() {
  if (!readabilitySrc) {
    readabilitySrc = fs.readFileSync(require.resolve('@mozilla/readability/Readability.js'), 'utf8');
  }
  return readabilitySrc;
}

const articles = new Map();
let nextId = 1;

async function extract(webContents) {
  const script = `(() => {
    try {
      ${getReadabilitySource()}
      const clone = document.cloneNode(true);
      const article = new Readability(clone).parse();
      if (!article || !article.content) return null;
      return {
        title: article.title || document.title,
        byline: article.byline || '',
        siteName: article.siteName || location.hostname,
        content: article.content,
        length: article.length || 0,
        url: location.href,
      };
    } catch (err) {
      return { error: String(err) };
    }
  })()`;
  const result = await webContents.executeJavaScript(script, true);
  if (!result || result.error) return null;
  const id = String(nextId++);
  articles.set(id, result);
  if (articles.size > 20) articles.delete(articles.keys().next().value);
  return id;
}

function get(id) {
  return articles.get(String(id)) || null;
}

module.exports = { extract, get };
