import {test,expect} from './authenticated-test';
test('current weather is larger than forecast range',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-09-08T10:00:00+09:00'));
 await page.route('**/api/weather',r=>r.fulfill({json:{status:'READY',temperatureC:17.2,windMs:2,humidityPercent:80,precipitationMm:1,observedAt:'2026-09-08T09:00:00+09:00'}}));
 await page.route('**/api/weather/forecast',r=>r.fulfill({json:{short:{status:'READY',points:[{at:'2026-09-08T11:00:00+09:00',temperatureC:20,windMs:1},{at:'2026-09-08T12:00:00+09:00',temperatureC:25,windMs:3}]}}}));
 await page.goto('/');const weather=page.getByTestId('today-weather');
 await expect(weather.getByTestId('current-temperature')).toContainText('17.2');
 await expect(weather.getByTestId('weather-day-range')).toContainText('20–25');
 expect(await weather.getByTestId('current-temperature').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThan(await weather.getByTestId('weather-day-range').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)));
 await weather.screenshot({path:'test-results/today-weather.png'});
 await page.setViewportSize({width:390,height:844});
 expect(await weather.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
});

test('weather values align with their daily ranges and source footer',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-09-22T18:30:00+09:00'));
 await page.route('**/api/weather',r=>r.fulfill({json:{status:'READY',temperatureC:17.2,windMs:2,humidityPercent:80,precipitationMm:1,observedAt:'2026-09-22T18:00:00+09:00'}}));
 const points=Array.from({length:24},(_,h)=>({at:`2026-09-22T${String(h).padStart(2,'0')}:00:00+09:00`,temperatureC:10+h%16,windMs:h%4,humidityPercent:50+h,precipitation:h<10?'1mm':'강수없음'}));
 await page.route('**/api/weather/forecast',r=>r.fulfill({json:{daily:{status:'READY',issuedAt:'2026-09-21T23:00:00+09:00',points},short:{status:'READY',points:[]}}}));
 await page.goto('/');const weather=page.getByTestId('today-weather');
 await expect(page.getByTestId('workspace-status').locator('time')).toHaveText('2026-09-22');
 await expect(weather.getByTestId('weather-temperature')).toContainText('현재기온');
 await expect(weather.getByTestId('weather-temperature')).toContainText('10–25 °C');
 await expect(weather.getByTestId('weather-wind')).toContainText('0–3 m/s');
 await expect(weather.getByTestId('weather-humidity')).toContainText('50–73 %');
 await expect(weather.getByTestId('weather-rain')).toContainText('10 mm');
 await expect(weather.locator('.weather-footer')).toContainText('오후 06:00');
 await expect(weather.locator('.weather-footer')).toContainText('출처 : 기상청');
 const cells=await weather.locator('.weather-value').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().y));expect(new Set(cells).size).toBe(1);
 await weather.getByRole('button',{name:'[상세 예보보기]'}).click();await expect(page.getByRole('dialog')).toContainText('전일 23시');
 await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click();
 await page.locator('.language-selector select').selectOption('en');await expect(weather).toContainText('Temperature now');await expect(weather).toContainText('Expected daily precipitation');
 await page.locator('.language-selector select').selectOption('ko');await weather.screenshot({path:'test-results/weather-grid.png'});
 await page.setViewportSize({width:390,height:844});expect(await weather.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
});

test('missing daily precipitation remains unknown and absent humidity range is omitted',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-09-22T18:30:00+09:00'));
 await page.route('**/api/weather',r=>r.fulfill({json:{status:'READY',temperatureC:0,windMs:0,humidityPercent:0,precipitationMm:0,observedAt:'2026-09-22T18:00:00+09:00'}}));
 await page.route('**/api/weather/forecast',r=>r.fulfill({json:{short:{status:'READY',points:[{at:'2026-09-22T19:00:00+09:00',temperatureC:20,windMs:1,humidityPercent:null,precipitation:'강수없음'}]}}}));
 await page.goto('/');const weather=page.getByTestId('today-weather');
 await expect(weather.getByTestId('weather-humidity')).not.toContainText('습도범위');
 await expect(weather.getByTestId('weather-rain').locator('.weather-value-range')).toContainText('—');
 await expect(weather.getByTestId('current-temperature')).toContainText('0 °C');
});
