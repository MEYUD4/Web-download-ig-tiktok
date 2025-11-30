// server.js
// Minimal Express backend untuk fetch halaman TikTok / Instagram
// Install: npm install express node-fetch@2 cheerio cors
const express = require('express');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Optional: serve frontend if you place index.html in same folder
const path = require('path');
app.use('/', express.static(path.join(__dirname)));

function safeText(s) {
  return s ? String(s).trim() : '';
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Downloader/1.0)',
      Accept: 'text/html,application/xhtml+xml,application/xml',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error('Fetch failed: ' + res.status);
  return await res.text();
}

function parseOpenGraph($) {
  const og = {};
  $('meta').each((i, el) => {
    const prop = $(el).attr('property') || $(el).attr('name');
    const content = $(el).attr('content');
    if (prop && content) og[prop.toLowerCase()] = content;
  });
  return og;
}

app.get('/api/fetch', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    // 1) Try open graph meta
    const og = parseOpenGraph($);
    let videoUrl = og['og:video:url'] || og['og:video'] || og['og:video:secure_url'] || og['og:video:url:secure'] || null;
    let thumbnail = og['og:image'] || og['og:image:secure_url'] || null;
    let caption = og['og:description'] || og['description'] || null;

    // 2) Try JSON-LD <script type="application/ld+json">
    if ((!videoUrl || !caption)) {
      $('script[type="application/ld+json"]').each((i, el) => {
        try {
          const j = JSON.parse($(el).contents().text());
          if (j) {
            if (!videoUrl) {
              if (j.video && (j.video.contentUrl || j.video.url)) videoUrl = j.video.contentUrl || j.video.url;
            }
            if (!caption) {
              if (j.caption) caption = j.caption;
              else if (j.description) caption = j.description;
            }
            if (!thumbnail && j.thumbnailUrl) thumbnail = Array.isArray(j.thumbnailUrl) ? j.thumbnailUrl[0] : j.thumbnailUrl;
          }
        } catch (e) { /* ignore bad json */ }
      });
    }

    // 3) Specific heuristics for TikTok/Instagram: search for script blocks that contain "playAddr" or "video_url"
    if (!videoUrl) {
      const bodyText = $.root().text();
      // TikTok often contains "playAddr":"https://v...mp4"
      const ttMatch = /"playAddr":"([^"]+\.mp4[^"]*)"/i.exec(html);
      if (ttMatch) {
        videoUrl = ttMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
      }
      // Instagram might contain "video_url":"..."
      const igMatch = /"video_url":"([^"]+)"/i.exec(html);
      if (igMatch) {
        videoUrl = igMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
      }
    }

    // 4) Fallback: try meta property "og:video" already attempted above.

    // Clean caption
    if (caption) {
      caption = caption.replace(/\s+/g, ' ').trim();
    } else {
      // try find text from page (first <meta name="description"> or first <p>)
      const desc = $('meta[name="description"]').attr('content') || $('p').first().text();
      caption = safeText(desc);
    }

    if (!videoUrl) {
      return res.status(404).json({ error: 'Video URL not found. Platform may block scraping or changed markup.' });
    }

    // Some URLs are relative or escaped, unescape common escapes
    videoUrl = videoUrl.replace(/\\u0026/g, '&').replace(/\\/g, '');
    return res.json({
      ok: true,
      video: videoUrl,
      caption: caption,
      thumbnail: thumbnail || null,
      source: url,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`GET /api/fetch?url=<post_url>`);
});
