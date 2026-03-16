const https = require('https');

function searchWindguru(query) {
  const options = {
    hostname: 'www.windguru.cz',
    path: `/int/iapi.php?q=search_spots&search=${encodeURIComponent(query)}`,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'application/json',
      'Referer': 'https://www.windguru.cz/'
    }
  };

  https.get(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        console.log(`Results for ${query}:`);
        json.forEach(item => {
          if (item.name.includes('South Africa')) {
            console.log(`- Spot: ${item.name} | ID: ${item.id_spot}`);
          }
        });
      } catch(e) { console.error('Parse error:', e.message); }
    });
  }).on('error', e => console.error(e));
}

searchWindguru('cape town');
searchWindguru('hout bay');
searchWindguru('simon');
searchWindguru('table bay');
searchWindguru('muizenberg');
