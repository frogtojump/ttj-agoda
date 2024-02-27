const puppeteer = require('puppeteer');
const { exec } = require('child_process');
const net = require('net');
const fs = require('fs');
const { log } = require('console');
const fsp = require('fs').promises;

// 헤드리스 모드 사용 여부를 결정하는 변수
const useHeadless = false; // true = 안보이는 크롬 , false = 보이는 크롬

// 1. URL 목록을 배열로 정의합니다.
const urls = [
  'https://www.agoda.com/ko-kr/search?city=1622', //마닐라
  'https://www.agoda.com/ko-kr/search?city=4001', //세부
  'https://www.agoda.com/ko-kr/search?city=17196', //바기오
  'https://www.agoda.com/ko-kr/search?city=15903', //보라카이
  'https://www.agoda.com/ko-kr/search?city=16429', //보홀
  'https://www.agoda.com/ko-kr/search?city=18218', //따가이따이
];

// 필리핀 저장할 파일
const fileName = 'Philippine.json';

// 2. 가격 랜덤 숫자 생성 함수
function getRandomNumber(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 2-1. 가격 범위 변수 정의 - 랜덤 숫자로 설정
const minPrice = getRandomNumber(10000, 100000).toString();
const maxPrice = (
  parseInt(minPrice) + getRandomNumber(50000, 70000)
).toString();

// 3. 크롬 실행 파일의 경로 윈도우 64bit
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
// 윈도우 32bit용
// const chromePath = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';

// 3-1. 디버깅 포트 설정
const debuggingPort = '9222';

// 3-2. 연결 설정을 변수로 저장
const connectionOptions = {
  browserURL: `http://127.0.0.1:${debuggingPort}`,
};

// 3-3. 원격 디버깅 크롬 실행 함수
function launchChromeWithRemoteDebugging() {
  exec(
    `"${chromePath}" --remote-debugging-port=${debuggingPort}`,
    (err, stdout, stderr) => {
      if (err) {
        console.error(`일반 크롬 종료, 디버깅 크롬 접속`);
        return;
      }
    }
  );
}

// 3-4. 포트 사용 여부 확인 함수
function checkPort(port, callback) {
  const client = new net.Socket();
  client.once('error', (err) => {
    if (err.code === 'ECONNREFUSED') {
      callback(false); // 연결 거부됨 - 포트 사용 안 함
    }
  });
  client.once('connect', () => {
    client.destroy();
    callback(true); // 연결 성공 - 포트 사용 중
  });
  client.connect({ port: port, host: '127.0.0.1' });
}

// 3-5. 크롬 프로세스 종료 및 재시작 함수
function killChromeProcesses() {
  checkPort(debuggingPort, (isInUse) => {
    if (!isInUse) {
      exec('taskkill /F /IM chrome.exe', (err, stdout, stderr) => {
        launchChromeWithRemoteDebugging();
        if (err) {
          console.error(`기존 크롬 종료`);
          return;
        }
      });
    } else {
      console.log(`9222 포트에서 크롬이 이미 실행 중입니다.`);
    }
  });
}

// A. 사람인듯한 행동패턴 셋트
// A-1. 맨 아래로 천천히 스크롤: await slowScrollToBottom(page);
async function slowScrollToBottom(page) {
  await page.evaluate(async () => {
    const randomWaitTime = () => Math.random() * (500 - 100) + 10; // 0.2초~0.8초 사이 랜덤

    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100; // 한 번에 스크롤할 픽셀 수

      const scrollOnce = () => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight < scrollHeight) {
          setTimeout(scrollOnce, randomWaitTime());
        } else {
          resolve();
        }
      };

      scrollOnce();
    });
  });
}

// A-2. 랜덤 스크롤 실행 코드: await randomScroll(page);
async function randomScroll(page) {
  const scrollDownCount = getRandomNumber(2, 7);
  const scrollUpCount = getRandomNumber(1, 5);
  const scrollDownAgainCount = getRandomNumber(2, 5);

  async function scroll(direction, count) {
    if (count > 0) {
      await page.evaluate(async (direction) => {
        const innerHeight = window.innerHeight;
        window.scrollBy(0, direction * innerHeight);
      }, direction);
      await page.waitForTimeout(
        getRandomWaitTime(0.2, direction === 1 ? 0.7 : 1.5)
      );
      await scroll(direction, count - 1);
    }
  }

  // 아래로 스크롤
  await scroll(1, scrollDownCount);

  // 위로 스크롤
  await scroll(-1, scrollUpCount);

  // 다시 아래로 스크롤
  await scroll(1, scrollDownAgainCount);
}

// A-3.랜덤 대기 시간: await page.waitForTimeout(getRandomWaitTime(0.5, 1.2));
function getRandomWaitTime(minSeconds, maxSeconds) {
  return (
    Math.floor(Math.random() * (maxSeconds - minSeconds + 1) + minSeconds) *
    1000
  );
}

// 호텔 아이디 추출, 솔드아웃이거나 시크릿 행사 호텔 제외
async function extractHotelInfo(page) {
  const hotels = await page.$$eval(
    '.hotel-list-container .PropertyCardItem',
    (nodes) =>
      nodes.map((n) => ({
        id: n.getAttribute('data-hotelid'),
        url: n.querySelector('a').href,
        isSoldOut: n.querySelector('.sold-out-message.info') !== null,
      }))
  );

  return hotels;
}

// 국가 주 + 도시 추출
async function extractLocationInfo(page) {
  try {
    // 국가 정보 추출
    const countrySelector =
      '#breadcrumb > div > div > ul > li:nth-child(3) > div > a > div';
    const country = await page.$eval(countrySelector, (element) =>
      element.textContent.trim()
    );

    // 주 정보 추출
    const stateSelector =
      '#breadcrumb > div > div > ul > li:nth-child(5) > div > a > div';
    const state = await page.$eval(stateSelector, (element) =>
      element.textContent.trim()
    );

    // 도시 정보 추출
    const citySelector =
      '#autocomplete-box > div > div > div > div.SearchBoxTextDescription__title';
    const city = await page.$eval(citySelector, (element) =>
      element.textContent.trim()
    );

    return { country, state, city };
  } catch (error) {
    console.error('국가,주,시티 값 없음:', error);
    return { country: '', state: '', city: '' };
  }
}

// 이미지 추출
async function extractAndLogImageInfo(page, item) {
  // 첫 번째 .Overlay 클릭
  const overlay = await item.$('.Overlay');
  await overlay.click();

  // 랜덤 대기 (1~3초 사이)
  await page.waitForTimeout(getRandomWaitTime(1, 3));

  // 모든 이미지 정보 추출
  const images = await page.$$eval('.sc-citwmv.btuXev img', (imgs) =>
    imgs.map((img) => ({ src: img.src, alt: img.alt }))
  );

  // 처음 5장 이미지 선택
  const firstFiveImages = images.slice(0, 5);

  // 랜덤 대기
  await page.waitForTimeout(getRandomWaitTime(1, 3));

  // 나머지 이미지 중 alt 값이 다른 것 선택
  const uniqueAltImages = images
    .slice(5)
    .filter(
      (img, index, self) => self.findIndex((t) => t.alt === img.alt) === index
    );

  // 필요한 경우 나머지 이미지에서 랜덤으로 선택
  let remainingImages = [];
  if (uniqueAltImages.length < 5) {
    const needed = 5 - uniqueAltImages.length;
    const otherImages = images
      .slice(5)
      .filter((img) => !uniqueAltImages.includes(img));
    remainingImages = otherImages
      .sort(() => 0.5 - Math.random())
      .slice(0, needed);
  }

  // 이미지 합치기
  const selectedImages = [
    ...firstFiveImages,
    ...uniqueAltImages,
    ...remainingImages,
  ];

  // 랜덤 대기
  await page.waitForTimeout(getRandomWaitTime(2, 5));

  // 모달 닫기
  const viewportSize = await page.viewport();
  await page.mouse.click(10, viewportSize.height / 2 + 50);

  // 랜덤 대기
  await page.waitForTimeout(getRandomWaitTime(2, 5));

  return selectedImages.slice(0, 10); // 최대 10개 이미지 반환
}

// 날짜 및 가격 설정, 검색 버튼 클릭
async function setDateAndPriceAndSearch(page, minPrice, maxPrice) {
  // 다음 달 버튼 클릭
  const nextMonthButtonSelector =
  'button[aria-label="Next Month"]';
  await page.click(nextMonthButtonSelector);

  // 날짜 선택 (1초 대기 후)
  const dateElements = await page.$$(
    '.PriceSurgePicker-Day__container.PriceSurgePicker-Day__container--wide'
  );

  if (dateElements.length > 0) {
    // 요소들 중에서 랜덤하게 하나를 선택
    const randomIndex = Math.floor(Math.random() * dateElements.length);
    const randomDateElement = dateElements[randomIndex];

    // 선택된 요소를 클릭
    await randomDateElement.click();
  } else {
    console.log('선택할 날짜 요소가 없습니다.');
  }

  // 검색 버튼 클릭 (7초 대기 후)
  await page.waitForTimeout(7000);
  const searchButtonSelector = '#SearchBoxContainer > div > div > button';
  await page.click(searchButtonSelector);

  await page.waitForTimeout(5000);

  // 좌표 (X: 244, Y: 572) 클릭
  await page.mouse.click(245, 570);

  // input #price_box_0 에 최소 가격 입력
  await page.type('input#price_box_0', minPrice, { delay: 700 });

  // input #price_box_1 에 최대 가격 입력
  await page.type('input#price_box_1', maxPrice, { delay: 500 });

  // 좌표 (X: 244, Y: 572) 클릭
  await page.mouse.click(244, 569);
  await page.waitForTimeout(5000); // 5초 대기
}

// JSON 파일에서 데이터 읽기
async function readDataFromFile(fileName) {
  try {
    const data = await fsp.readFile(fileName, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return 'null'; // 파일이 없거나 읽을 수 없는 경우 "null" 반환
  }
}

// 중복 데이터 제거 및 JSON 파일에 크롤링 결과 저장하는 함수
async function saveUniqueHotelIdsToFile(hotelInfo, fileName) {
  let existingData = await readDataFromFile(fileName);
  // 파일에서 읽은 데이터가 없거나 'hotels' 키가 없는 경우 초기화
  if (!existingData || !Array.isArray(existingData.hotels)) {
    existingData = { hotels: [] };
  }

  const newHotels = hotelInfo
    .filter(
      (hotel) =>
        !existingData.hotels.some(
          (existingHotel) => existingHotel['hotel_id'] === hotel.id
        )
    )
    .map((hotel) => {
      // 이미지 정보 변환
      const imagesData = {};
      hotel.images.forEach((img, index) => {
        imagesData[`photo${index + 1}`] = { src: img.src, alt: img.alt };
      });

      // 호텔 정보 객체 반환
      return {
        hotel_id: hotel.id,
        url: hotel.url,
        country: hotel.country,
        state: hotel.state,
        city: hotel.city,
        hotel_name: hotel.detail.hotel_name,
        hotel_translated_name: hotel.detail.hotel_translated_name,
        star_rating: hotel.detail.starRating,
        rating: hotel.detail.customerRating,
        feedback: hotel.detail.feedback,
        hotel_service: hotel.detail.hotelService,
        latitude: hotel.detail.latitude,
        longitude: hotel.detail.longitude,
        review_count: hotel.detail.reviewCount,
        review_scores: hotel.detail.reviewScores,
        hotel_message: hotel.detail.hotelMessage,
        famous_place: hotel.detail.famousPlace,
        hotel_desc: hotel.detail.hotelDesc,
        faqs: hotel.detail.faqs,
        langs_more_info: hotel.detail.langsMoreInfo,
        near_info: hotel.detail.nearInfo,
        check_more_info: hotel.detail.checkMoreInfo,
        reviews: hotel.detail.reviews,
        ...imagesData, // 변환된 이미지 정보 추가
      };
    });

  const updatedData = {
    hotels: [...existingData.hotels, ...newHotels],
  };

  try {
    await fsp.writeFile(fileName, JSON.stringify(updatedData, null, 2));
  } catch (error) {
    console.error('파일 저장 중 오류 발생:', error);
    return; // 오류 발생 시 함수를 종료합니다.
  }

  // 반환 값 추가: 새로 저장된 호텔 수와 전체 저장된 호텔 수
  return {
    newSavedHotelCount: newHotels.length,
    currentSavedHotelCount: updatedData.hotels.length,
  };
}

// 호텔 아이디와 URL 추출 함수
async function extractHotelInfo(page) {
  const hotels = await page.$$eval(
    '.hotel-list-container .PropertyCardItem',
    (nodes) =>
      nodes.map((n) => ({
        id: n.getAttribute('data-hotelid'),
        url: n.querySelector('a').href,
      }))
  );
  return hotels;
}

//상세페이지 크롤링
async function detailCrawl(page, url) {
  console.log(`상세 페이지 크롤링 시작: ${url}`);
  const startTime = Date.now(); // 시작 시간 기록
  try {
    // 뷰포트 크기 설정
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(url, { waitUntil: 'networkidle2' });
    await page.screenshot({ path: '1_screenshot.png' });
    // 랜덤 대기 시간 생성 및 대기
    await page.waitForTimeout(getRandomWaitTime(0.5, 1.2));
    await page.waitForSelector('.HeaderCerebrum__Name');

    //맨 밑으로 천천히 스크롤
    await slowScrollToBottom(page);
    await page.screenshot({ path: '2_screenshot.png' });
    // 랜덤 대기 시간 생성 및 대기
    await page.waitForTimeout(getRandomWaitTime(0.5, 0.7));

    // 랜덤 스크롤 동작
    await randomScroll(page);

    // 1. 호텔 이름 크롤링
    await page.waitForTimeout(getRandomWaitTime(0.2, 0.7));
    const nameSelector = '.HeaderCerebrum__Name';
    const fullName = await page
      .$eval(nameSelector, (el) => el.innerText)
      .catch(() => 'null');

    if (!fullName) {
      console.log('호텔 이름을 찾을 수 없습니다.');
      return { hotel_name: 'null', hotel_translated_name: 'null' };
    }

    // await randomRightClick(page); // 랜덤 우클릭

    // 2.성급 정보 크롤링
    await page.waitForTimeout(getRandomWaitTime(0.2, 1.2));
    
    const ratingSelector =
      '.sc-bdfBwQ.sc-gsTCUz.kNUszl .Spanstyled__SpanStyled-sc-16tp9kb-0.gwICfd.kite-js-Span.star-rating.display-inline.HeaderCerebrum__Rating';

    // 2-1.성급 정보 추출
    const starRatingText = await page
      .$eval(ratingSelector, (el) => el.getAttribute('aria-label'))
      .catch(() => '');
    let starRating = '';
    if (starRatingText) {
      const match = starRatingText.match(/(\d+)/);
      if (match) {
        starRating = parseInt(match[1], 10);
      }
    }
    console.log('추출된 성급 정보:', starRating);

    // 3.고객 평점 추출
    await page.waitForTimeout(getRandomWaitTime(0.3, 1.5));
    const customerRatingSelector = '.sc-jrAGrp.sc-kEjbxe.fzPhrN.gOeEsn';
    let customerRating = await page
      .$eval(customerRatingSelector, (el) => el.innerText)
      .catch(() => '');

    // 고객 평점이 없거나 유효하지 않은 경우, 100으로 설정
    if (!customerRating || isNaN(customerRating)) {
      customerRating = '100'; //신규 호텔 표시
    }

    // 4. 최고, 우수, 매우좋음 고객 피드백
    const feedbackSelector = '.sc-jrAGrp.sc-kEjbxe.bvAJVt.gOeEsn';
    let feedback = '신규 호텔';

    try {
      feedback = await page.$eval(feedbackSelector, (el) =>
        el.innerText.trim()
      );
    } catch (error) {
      // 요소가 없는 경우 빈 문자열로 유지
      console.log('고객 피드백을 찾을 수 없습니다:');
    }

    await page.waitForTimeout(getRandomWaitTime(0.2, 1.2));
    // 5. 리뷰 갯수 추출하기
    const reviewCountSelector =
      '.review-basedon .text .Typographystyled__TypographyStyled-sc-j18mtu-0.Hkrzy.kite-js-Typography';
    let reviewCount = '신규 호텔'; // Default value
    try {
      const reviewCountText = await page.$eval(
        reviewCountSelector,
        (el) => el.innerText
      );
      const match = reviewCountText.match(/(\d[\d,]*)/); // Regular expression to extract number
      if (match && match[1]) {
        // Convert to number and then format with commas
        reviewCount = parseInt(match[1].replace(/,/g, ''), 10).toLocaleString();
      }
    } catch (error) {
      console.log('리뷰 갯수를 찾을 수 없습니다:');
    }
    await page.waitForTimeout(getRandomWaitTime(0.2, 1.2));

    // 6. 리뷰 디테일 점수
    const reviewScores = await page.evaluate(() => {
      const reviewCells = document.querySelectorAll(
        '.Review-travelerGrade-Cell .Review-travelerGrade'
      );

      // 리뷰 셀이 없는 경우 '신규 호텔' 반환
      if (reviewCells.length === 0) {
        return '신규 호텔';
      }

      const scores = {};
      reviewCells.forEach((cell) => {
        // 각 셀 내부의 .Review-travelerGradeCategory와 .Review-travelerGradeScore--highlight 요소 찾기
        const categoryElement = cell.querySelector(
          '.Review-travelerGradeCategory'
        );
        const scoreElement = cell.querySelector(
          '.Review-travelerGradeScore--highlight'
        );

        // 두 요소가 모두 존재하는 경우, 카테고리와 점수를 scores 객체에 저장
        if (categoryElement && scoreElement) {
          const category = categoryElement.innerText.trim();
          const score = scoreElement.innerText.trim();
          scores[category] = score;
        }
      });

      return scores;
    });

    await page.waitForTimeout(getRandomWaitTime(0.2, 1.2));

    // 7. 위도와 경도 추출
    let latitude = '홈페이지확인';
    let longitude = '홈페이지확인';

    try {
      latitude = await page
        .$eval("meta[property='place:location:latitude']", (el) => el.content)
        .catch(() => '홈페이지확인');
      longitude = await page
        .$eval("meta[property='place:location:longitude']", (el) => el.content)
        .catch(() => '홈페이지확인');
    } catch (error) {
      console.log('위도 또는 경도 정보를 찾을 수 없습니다:');
    }

    //8. 호텔 간단 소개
    const hotelDescSelector =
      '.Typographystyled__TypographyStyled-sc-j18mtu-0.fHvoAu.kite-js-Typography';
    let hotelDesc = ''; // Default value
    try {
      hotelDesc = await page.$eval(hotelDescSelector, (el) =>
        el.innerText.trim()
      );
    } catch (error) {
      console.log('호텔 간단한 소개를 찾을 수 없습니다:');
    }

    // 랜덤 스크롤 동작
    await randomScroll(page);

    await page.waitForTimeout(getRandomWaitTime(0.2, 1.2));

    // 9. 편의시설 및 서비스 추출
    const hotelServiceSelector = '.Box-sc-kv6pi1-0.dPyGvZ';
    let hotelService = ''; // Default value
    try {
      let hotelServiceText = await page.$eval(hotelServiceSelector, (el) =>
        el.innerText.trim()
      );
      hotelService = hotelServiceText.replace(/\n+/g, ', '); // 개행 문자를 쉼표로 대체
    } catch (error) {
      console.log('편의시설 및 서비스를 찾을 수 없습니다:');
    }
    await page.waitForTimeout(getRandomWaitTime(0.2, 1.2));

    await randomScroll(page);

    // 10. 명소 정보 추출
    const famousPlace = await page.evaluate(() => {
      const attractionGroups = [];
      const attractionBoxElements = document.querySelectorAll(
        '.Box-sc-kv6pi1-0.krvZGc'
      );

      attractionBoxElements.forEach((box) => {
        const titleElement = box.querySelector('.Box-sc-kv6pi1-0.fFMRKs');
        const title = titleElement ? titleElement.innerText.trim() : '';

        const famousPlace = [];
        const attractionElements = box.querySelectorAll(
          '[data-element-name="poi-image-tooltip-property-feature"]'
        );
        attractionElements.forEach((el) => {
          const nameElement = el.querySelector(
            '.Typographystyled__TypographyStyled-sc-j18mtu-0.dkxzVC.kite-js-Typography.Box-sc-kv6pi1-0.eaWvaB'
          );
          const distanceElement = el.querySelector(
            '.Typographystyled__TypographyStyled-sc-j18mtu-0.dkxzVC.kite-js-Typography:not(.Box-sc-kv6pi1-0.eaWvaB)'
          );

          const name = nameElement ? nameElement.innerText.trim() : '';
          const distance = distanceElement
            ? distanceElement.innerText.trim()
            : '';

          famousPlace.push({ name, distance });
        });

        attractionGroups.push({ title, famousPlace });
      });
      return attractionGroups;
    });
    await page.waitForTimeout(getRandomWaitTime(0.2, 1.2));
    // 11. 자주 묻는 질문 추출
    const faqs = await page.evaluate(() => {
      const faqElements = document.querySelectorAll(
        '.Box-sc-kv6pi1-0.QfIMZ .sc-bdfBwQ.sc-gsTCUz.eKhSMu'
      );
      const faqData = Array.from(faqElements).map((faq) => {
        const questionElement = faq.querySelector(
          '.sc-jrAGrp.sc-kEjbxe.eDlaBj.eFmRiH'
        );
        const answerElement = faq.querySelector(
          '.sc-jrAGrp.sc-kEjbxe.eDlaBj.kBTPgA'
        );

        const question = questionElement
          ? questionElement.innerText.trim()
          : '';
        const answer = answerElement ? answerElement.innerText.trim() : '';
        return { question, answer };
      });
      return faqData;
    });

    await randomScroll(page);

    //14. 호텔 메세지 자리.
    const aboutHotelPanelSelector = '#abouthotel-panel';
    let hotelMessage = '이 호텔에서 제공하는 메세지는 홈페이지를 확인하세요';

    try {
      await page.waitForSelector(aboutHotelPanelSelector);
      hotelMessage = await page.evaluate(() => {
        const aboutHotelPanel = document.querySelector('#abouthotel-panel');
        if (aboutHotelPanel) {
          const firstItem = aboutHotelPanel.querySelector(
            '.Itemstyled__Item-sc-12uga7p-0.dAzOrK.Box-sc-kv6pi1-0.sc-ihsSHl.hRUYUu.eVBZHh'
          );
          if (firstItem) {
            const collapseSection = firstItem.querySelector(
              '.SectionCollapse--collapse'
            );
            if (collapseSection) {
              return collapseSection.textContent.trim();
            }
          }
        }
        return ''; // 해당 요소가 없을 경우 빈 문자열 반환
      });
    } catch (error) {
      console.log('호텔 메시지를 찾을 수 없습니다:');
    }

    // 14. 언어
    // 첫 번째 FeatureGroup 내에서 h5 태그가 있는 처음 5개 Box의 h5 소제목과 li 텍스트들을 추출
    await page.waitForTimeout(getRandomWaitTime(0.2, 1.2));

    const featureGroupSelector = '.Box-sc-kv6pi1-0.cTxLvk.FeatureGroup';
    const boxSelector = '.Box-sc-kv6pi1-0.dtSdUZ';

    let langsMoreInfo = [];

    try {
      // 페이지에 필요한 요소가 로드될 때까지 기다림
      await page.waitForSelector(featureGroupSelector);

      const firstFeatureGroup = await page.$(featureGroupSelector);
      const allBoxes = await firstFeatureGroup.$$(boxSelector);

      for (const box of allBoxes) {
        const h5Element = await box.$('h5');
        if (h5Element) {
          const subTitle = await box.$eval('h5', (h5) => h5.innerText.trim());
          const listItems = await box.$$eval('ul li', (lis) =>
            lis.map((li) => li.innerText.trim())
          );
          langsMoreInfo.push({ subTitle, listItems });
        }
      }
    } catch (error) {
      console.error('필요한 정보를 찾을 수 없습니다:');
    }

    // 15. 특정 클래스 요소들의 텍스트 추출
    const infoBoxesSelector = '.Box-sc-kv6pi1-0.cTxLvk.FeatureGroup';
    let nearInfo = [];

    try {
      const infoBoxes = await page.$$(infoBoxesSelector);

      if (infoBoxes.length > 2) {
        const thirdBoxGroup = infoBoxes[2];
        const boxes = await thirdBoxGroup.$$('.Box-sc-kv6pi1-0.dtSdUZ');

        for (const box of boxes) {
          // h5 태그가 있는지 확인
          const h5Handle = await box.$('h5');
          if (h5Handle) {
            const subTitle = await box.$eval('h5', (h5) => h5.innerText.trim());
            const listItems = await box.$$eval('ul li', (lis) =>
              lis.map((li) => li.innerText.trim().replace(/\n/g, ': '))
            );

            nearInfo.push({ subTitle, listItems });
          }
        }
      } else {
        console.log('세 번째 FeatureGroup을 찾을 수 없습니다.');
      }
    } catch (error) {
      console.log('정보 박스를 찾을 수 없습니다:');
    }

    // 16. 체크인/체크아웃/포함정보
    const featureGroupsSelector = '.Box-sc-kv6pi1-0.cTxLvk.FeatureGroup';
    let checkMoreInfo = [];

    try {
      const featureGroups = await page.$$(featureGroupsSelector);

      if (featureGroups.length > 0) {
        const lastFeatureGroup = featureGroups[featureGroups.length - 1];

        // h5 텍스트 추출
        const subTitle = await lastFeatureGroup.$eval('h5', (h5) =>
          h5 ? h5.textContent.trim() : 'No h5 element found'
        );

        // li 텍스트들 추출
        const listItems = await lastFeatureGroup.$$eval('li', (lis) =>
          lis.map((li) => li.textContent.trim())
        );

        checkMoreInfo.push({ subTitle, listItems });
      } else {
        console.log('지정된 클래스를 가진 FeatureGroup이 없습니다.');
      }
    } catch (error) {
      console.log('정보를 추출하는 중 오류 발생:');
    }

    // 17. 리뷰 추출
    const reviewSectionSelector = '#reviewSectionComments';
    let reviews = [];

    try {
      const reviewSection = await page.$(reviewSectionSelector);

      if (reviewSection) {
        const reviewComments = await reviewSection.$$('.Review-comment');

        if (reviewComments.length > 0) {
          for (const comment of reviewComments) {
            const subheading =
              (await comment.$eval('h3', (h3) => h3.textContent.trim())) ||
              'No subheading';
            const bodyText =
              (await comment.$eval('.Review-comment-bodyText', (div) =>
                div.textContent.trim()
              )) || 'No body text';

            reviews.push({ subheading, bodyText });
          }
        } else {
          // 리뷰 코멘트가 없는 경우
          reviews.push('리뷰없음');
        }
      } else {
        // 리뷰 섹션이 없는 경우
        reviews.push('리뷰없음');
      }
    } catch (error) {
      console.log('Error while extracting review comments:');
    }

    // 괄호 안의 영어 이름 추출
    const englishNameMatch = fullName.match(/\((.*?)\)/);
    const englishName = englishNameMatch ? englishNameMatch[1].trim() : '';

    // 괄호와 한글 내용 제거
    const cleanedName = fullName.replace(/\s*\(.*?\)\s*/g, '').trim();

    let hotel_name = englishName || cleanedName; // 영어 이름 우선, 없으면 기본 이름 사용
    let hotel_translated_name;

    // 한글이 포함되었는지 확인
    if (/[\uAC00-\uD7A3]/.test(cleanedName)) {
      hotel_translated_name = cleanedName; // 한글 이름 사용
    } else {
      hotel_translated_name = englishName || cleanedName; // 한글 이름이 없으면 영어 이름 사용
    }

    const endTime = Date.now(); // 종료 시간 기록
    const duration = (endTime - startTime) / 1000; // 밀리초를 초로 변환
    console.log(`크롤링 시간: ${duration.toFixed(2)}초`); // 소수점 둘째 자리까지 반올림하여 표시

    return {
      hotel_name,
      hotel_translated_name,
      starRating,
      customerRating,
      feedback,
      reviewCount,
      reviewScores,
      hotelDesc,
      hotelService,
      hotelMessage, //호텔 메세지
      famousPlace, //명소 저장
      langsMoreInfo, // 사용 가능한 언어 리스트
      nearInfo, //정보 박스
      checkMoreInfo, //체크인 박스
      faqs, //자주묻는 질문
      reviews,
      latitude, // 추가된 위도 필드
      longitude, // 추가된 경도 필드
    };
  } catch (error) {
    console.log('호텔 상세 정보를 찾을 수 없습니다. 다음 호텔로 넘어갑니다:');
    return null; // 오류 발생 시 null 반환
  }
}

// 호텔이 이미 저장되었는지 확인하는 함수
async function isHotelAlreadySaved(hotelId, fileName) {
  const data = await readDataFromFile(fileName);
  if (data && data.hotels) {
    return data.hotels.some((hotel) => hotel['hotel_id'] === hotelId);
  }
  return false;
}

// 메인 크롤링 함수
async function crawlAndSaveHotelIds() {
  let browser;
  if (useHeadless) {
    browser = await puppeteer.launch({
      headless: 'new', // 헤드리스 모드 사용
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        `--user-agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"`,
        `--disable-infobars`,
        '--disable-blink-features=AutomationControlled',
      ],
    });
  } else {
    killChromeProcesses(); // 크롬 프로세스 관리
    await new Promise((resolve) => setTimeout(resolve, 2000)); // 크롬 실행 대기

    browser = await puppeteer.connect(connectionOptions);
  }

  const page = await browser.newPage();

  // Set the browser viewport to 1920x1080
  await page.setViewport({ width: 1920, height: 1080 });

  // 랜덤 URL 선택 및 페이지 이동
  const randomUrl = urls[Math.floor(Math.random() * urls.length)];
  await page.goto(randomUrl, { waitUntil: 'networkidle2' });
  console.log(`페이지 로드 완료: ${randomUrl}`);

  // 날짜 및 가격 설정, 검색 버튼 클릭
  await setDateAndPriceAndSearch(page, minPrice, maxPrice);

  // 스크린샷 찍기
  await page.screenshot({ path: 'first_screenshot.png' });

  let totalSearched = 0;
  let totalDuplicated = 0;
  let totalNewSaved = 0;
  let totalCurrentSaved = 0;
  let currentHotelIndex = 0; // 현재 호텔 인덱스 카운터
  let totalSoldOut = 0; // 솔드아웃된 호텔 수를 카운트하는 변수 초기화

  let continueCrawling = true;
  while (continueCrawling) {
    // 가격 입력 후 랜덤 대기
    await page.waitForTimeout(getRandomWaitTime(1, 1.2));

    let hasNextPage = true;
    while (hasNextPage) {
      await page.mouse.click(673, 373);

      await slowScrollToBottom(page); // 맨 밑으로 스크롤
      await page.screenshot({ path: 'last.screenshot.png' });
      // 랜덤 우클릭 수행
      // await randomRightClick(page);

      // 크롤링할 호텔 요소가 있는지 확인
      const propertyCards = await page.$$('.PropertyCardItem');
      if (propertyCards.length === 0) {
        console.log(
          '더 이상 크롤링할 페이지가 없습니다. 프로그램을 종료합니다.'
        );
        continueCrawling = false; // 크롤링 종료
        break; // while 루프 탈출
      }

      currentHotelIndex = 0; // 페이지 처리 시작 시 인덱스 초기화

      // 스크롤 후 랜덤 대기 (2~5초)
      await page.waitForTimeout(getRandomWaitTime(1, 3));

      // 호텔 정보 추출
      const hotels = await extractHotelInfo(page);
      totalSearched += hotels.length;

      let totalDuplicatesInThisPage = 0;
      let totalSoldOutInThisPage = 0;
      let totalToCrawlInThisPage = 0;
      let totalSecretProductsInThisPage = 0;

      for (const hotel of hotels) {
        if (hotel.isSoldOut) {
          totalSoldOutInThisPage++;
          continue;
        }
        const isDuplicate = await isHotelAlreadySaved(hotel.id, fileName);
        if (isDuplicate) {
          totalDuplicatesInThisPage++;
          continue;
        }
        totalToCrawlInThisPage++; // 크롤링할 호텔 수 증가
      }

      // 로그 출력
      console.log(
        `페이지 분석: 총 호텔 ${hotels.length}, 중복된 호텔 ${totalDuplicatesInThisPage}, 솔드아웃된 호텔 ${totalSoldOutInThisPage}, 크롤링할 호텔 ${totalToCrawlInThisPage}`
      );

      // 솔드아웃
      for (const hotel of hotels) {
        if (
          hotel.isSoldOut ||
          (await isHotelAlreadySaved(hotel.id, fileName))
        ) {
          continue;
        }

        currentHotelIndex++;
        console.log(
          `상세 페이지로 이동 중: 호텔 ${currentHotelIndex}/${totalToCrawlInThisPage}`
        );

        // 이미지 추출
        const item = await page.$(`[data-hotelid="${hotel.id}"]`);
        if (!item) {
          console.log(`호텔 아이템을 찾을 수 없습니다: ${hotel.id}`);
          continue;
        }
        const imageInfo = await extractAndLogImageInfo(page, item);

        // 이미지가 없는 경우, 시크릿 호텔로 간주하고 건너뜀
        if (imageInfo.length === 0) {
          console.log(`시크릿 호텔 발견: ${hotel.id}`);
          totalSecretProductsInThisPage++;
          continue;
        }

        const locationInfo = await extractLocationInfo(page);

        // 호텔 상세 정보와 이미지 정보를 결합
        const hotelData = {
          ...hotel,
          country: locationInfo.country,
          state: locationInfo.state,
          city: locationInfo.city,
          images: imageInfo,
        };

        const newTab = await browser.newPage();
        const detailData = await detailCrawl(newTab, hotelData.url);
        await newTab.close();

        // 상세 정보를 hotelData 객체에 추가
        if (detailData) {
          hotelData.detail = detailData;
        }

        // 기본 정보와 상세 정보를 함께 저장
        const saveResult = await saveUniqueHotelIdsToFile(
          [hotelData],
          fileName
        );

        if (saveResult.newSavedHotelCount > 0) {
          totalNewSaved += saveResult.newSavedHotelCount; // 새로 저장된 호텔 수 업데이트
        } else {
          totalDuplicated++; // 중복된 호텔 수 증가
        }
        totalCurrentSaved = saveResult.currentSavedHotelCount; // 현재 저장된 호텔 수 업데이트
      }

      // 각 호텔에 대한 처리가 끝난 후 전체 카운트 업데이트
      totalSoldOut += totalSoldOutInThisPage; // 전체 솔드아웃 호텔 수 업데이트

      // 다음 페이지 버튼 확인
      const nextPageButton = await page.$('#paginationNext > div > div > span');
      if (nextPageButton) {
        await nextPageButton.click();
        await page.waitForTimeout(3000); // 다음 페이지 로딩 대기
      } else {
        log('다음페이지없음');
        hasNextPage = false; // 다음 페이지가 없으므로 루프 종료
      }

      // 내부 루프가 끝나면 외부 루프도 종료
      continueCrawling = false;

      // 최종 로그 출력
      console.log(
        `크롤링 완료. 총 검색된 호텔 수: ${totalSearched}, 솔드아웃 호텔 수: ${totalSoldOut}, 중복된 호텔 수: ${totalDuplicated}, 새로 저장된 호텔 수: ${totalNewSaved}, 현재 저장된 호텔 수: ${totalCurrentSaved}`
      );
    }

    await page.close();
  }

  process.exit(); // 프로그램 종료
}

// 에러 핸들링 함수
function handleError(error) {
  // console.error('에러 발생:', error);
  console.error('에러 발생: 브라우저가 종료되어 다시 시작합니다');
  process.exit(1); // 에러 발생 시 프로그램 종료
}

// 전역 에러 핸들링
process.on('uncaughtException', handleError);
process.on('unhandledRejection', handleError);

// 메인 프로세스 실행
(async () => {
  try {
    await crawlAndSaveHotelIds();
  } catch (error) {
    handleError(error);
  }
})();
