import {test,expect} from './authenticated-test';
test('live KMA response is displayed without changing the plan',async({page})=>{
 test.skip(process.env.KMA_LIVE_VERIFY!=='1','Explicit opt-in for a real KMA request');
 const before=await (await page.request.get('/api/demo')).json();
 const weather=await (await page.request.get('/api/weather')).json();
 expect(weather.status).toBe('READY');expect(weather.grid).toEqual({nx:72,ny:88});
 const forecasts=await (await page.request.get('/api/weather/forecast')).json();
 for(const kind of ['ultra','short']){expect(forecasts[kind].status).toBe('READY');expect(forecasts[kind].points.length).toBeGreaterThan(0)}
 await page.goto('/references');const panel=page.getByTestId('live-weather');
 await expect(panel.getByText(/기온:/)).toContainText(`${weather.temperatureC} °C`);
 await expect(panel).toContainText('72, 88');
 await expect(page.getByTestId('forecast-ultra')).toContainText('응답 기준시각');
 await expect(page.getByTestId('forecast-short')).toContainText('응답 기준시각');
 await page.getByLabel('언어 / Language').selectOption('en');
 await expect(panel.getByText(/Temperature:/)).toContainText(`${weather.temperatureC} °C`);
 await expect(page.getByTestId('forecast-short')).toContainText('Response base time');
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/kma-forecast-en-mobile.png',fullPage:true});
 expect((await (await page.request.get('/api/demo')).json()).state).toEqual(before.state);
});
test('unconfigured weather is honest, bilingual, and does not alter the plan',async({page})=>{
 const before=await (await page.request.get('/api/demo')).json();
 await page.route('**/api/weather/forecast',r=>r.fulfill({json:{ultra:{status:'UNAVAILABLE',points:[]},short:{status:'NOT_CONFIGURED',points:[]}}}));
 await page.route('**/api/weather',r=>r.fulfill({json:{status:'NOT_CONFIGURED',source:'KMA_ULTRA_SHORT_OBSERVATION',fetchedAt:'2026-09-08T00:00:00Z'}}));
 await page.goto('/references');
 const panel=page.getByTestId('live-weather');
 await expect(panel.getByText(/연결 대기/)).toBeVisible();
 await page.getByLabel('언어 / Language').selectOption('en');
 await expect(panel.getByText(/Connection pending/)).toBeVisible();
 await expect(page.getByTestId('forecast-ultra')).toContainText('Forecast unavailable');
 await expect(page.getByTestId('forecast-short')).toContainText('Connection pending');
 await expect(panel.getByText(/do not automatically alter/)).toBeVisible();
 expect((await (await page.request.get('/api/demo')).json()).state).toEqual(before.state);
});
