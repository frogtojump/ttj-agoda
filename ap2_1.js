require('dotenv').config({ path: '/var/www/html/.env' }); // 환경 변수 로드

const puppeteer = require('puppeteer');
const mysql = require('mysql');
const { exec } = require('child_process');
const fs = require('fs');

// 데이터베이스 연결 설정
const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME1
});

// 데이터베이스 연결
connection.connect((error) => {
  if (error) throw error;

  connection.query("SELECT * FROM city ORDER BY RAND() LIMIT 1", async (error, results) => {
    if (error) {
      console.error('Error fetching data from database:', error);
      connection.end();
      return;
    }

    let browser; // browser 변수를 try 블록 바깥에서 선언합니다.
    try {
      const city_url = results[0].url;
      const city_name = results[0].cityname;

      browser = await puppeteer.launch({ // browser 변수를 여기에서 초기화합니다.
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      const page = await browser.newPage();
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      );

      if (city_url.includes('city')) {
        await processCityUrl(page, city_url);
      } else if (city_url.includes('country')) {
        await processCountryUrl(page, city_url);
      } else {
        console.log('Selected URL does not contain "city" or "country".');
      }

      // 데이터베이스 연결 종료
      connection.end();

      // PHP 스크립트 실행
      exec(`php /var/www/html/ap2.php ${city_name}`, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error executing PHP script: ${error}`);
        } else {
          console.log(`PHP Output: ${stdout}`);
        }
      });
    } catch (err) {
      console.error('An error occurred during the browser operation:', err);
    } finally {
      if (browser) { // browser가 정의되어 있으면 닫습니다.
        await browser.close();
      }
    }
  });
});

async function processCityUrl(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.DatelessPropertyCard__Content');
  const result = await commonCrawlingLogic(page);
  fs.writeFileSync('/var/www/html/city_hotels.json', JSON.stringify(result));
}

async function processCountryUrl(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#topcityContainer .geoTopCityName a');
  const cityLinks = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('#topcityContainer .geoTopCityName a'));
    return anchors.map(anchor => anchor.href);
  });
  const randomCityLink = cityLinks[Math.floor(Math.random() * cityLinks.length)];
  await page.goto(randomCityLink, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.DatelessPropertyCard__Content');
  const result = await commonCrawlingLogic(page);
  fs.writeFileSync('/var/www/html/city_hotels.json', JSON.stringify(result));
}

async function commonCrawlingLogic(page) {
  return page.evaluate(() => {
    const hotels = [];
    const elements = document.querySelectorAll('.DatelessPropertyCard__Content');
  
    elements.forEach((element, index) => {
      if (index < 5) { // 상위 5개만 추출
        const name = element.querySelector('.DatelessPropertyCard__ContentHeader')?.innerText || "";
        const link = element.querySelector('a')?.href || "";
        const details = element.querySelector('.DatelessPropertyCard__ContentDetail')?.innerText || "";
        const rating = element.parentElement.querySelector('.Box-sc-kv6pi1-0')?.innerText || "";
        const facilities = Array.from(element.querySelectorAll('.Pills li'))
                                .slice(0, -1) // 마지막 li 제외
                                .map(li => li.innerText || "")
                                .join(", ");
        let image = element.parentElement.querySelector('.DatelessPropertyCard__Gallery img')?.src || "";
  
        // 이미지 URL에서 's=450x450' 제거
        image = image.replace(/\?ca=\d+&ce=\d+&s=450x450$/, '');
  
        hotels.push({ name, link, details, rating, facilities, image});
      }
    });
  
    return hotels;
  });
}

