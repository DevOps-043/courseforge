
import fetch from 'node-fetch';

async function testMetadata() {
    console.log('--- VIMEO TEST ---');
    const vimeoUrl = 'https://vimeo.com/76979871';
    try {
        const res = await fetch(`https://vimeo.com/api/oembed.json?url=${vimeoUrl}`);
        const data = await res.json();
        console.log(`Vimeo Duration: ${data.duration} seconds`);
        console.log(`Vimeo Title: ${data.title}`);
    } catch (e) {
        console.error('Vimeo Error:', e.message);
    }

    console.log('\n--- YOUTUBE TEST (oEmbed) ---');
    const ytId = '4HBsXulKPi4';
    const ytUrl = `https://www.youtube.com/watch?v=${ytId}`;
    try {
        const res = await fetch(`https://www.youtube.com/oembed?url=${ytUrl}&format=json`);
        // YouTube oEmbed usually DOES NOT return duration, let's verify.
        const data = await res.json();
        console.log('YouTube oEmbed Keys:', Object.keys(data));
        console.log(`YouTube Title: ${data.title}`);
    } catch (e) {
        console.error('YouTube oEmbed Error:', e.message);
    }

    console.log('\n--- YOUTUBE TEST (Scraping) ---');
    // Attempting to fetch page to find duration meta tag
    // <meta itemprop="duration" content="PT1H11M11S">
    try {
        const res = await fetch(ytUrl);
        const text = await res.text();
        // Regex for ISO 8601 duration inside meta tag
        const match = text.match(/itemprop="duration" content="([^"]+)"/);
        if (match) {
            console.log(`YouTube Scraped Duration (ISO): ${match[1]}`);
        } else {
            console.log('YouTube Scraped Duration: Not found in meta tags (might be CSR loaded)');
        }

        // Sometimes it's in "microformatDataRenderer" JSON in the HTML
        if (text.includes('videoDurationSeconds')) {
            const matchSec = text.match(/"videoDurationSeconds":"(\d+)"/);
            if (matchSec) console.log(`YouTube Scraped Duration (JSON seconds): ${matchSec[1]}`);
        }
    } catch (e) {
        console.error('YouTube Scraping Error:', e.message);
    }
}

testMetadata();
