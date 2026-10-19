import {expect,type Page} from '@playwright/test';

/** Navigate through the ordinary schedule, never a separate equipment ledger. */
export async function openWorkOrder(page:Page,task:{id:string;date?:string;scheduledDate?:string}){
 const date=task.date??task.scheduledDate;if(!date)throw Error('Scheduled task required');
 await page.goto('/?tab=schedule');
 await page.getByRole('combobox',{name:/^(일정 연도|Schedule year)$/}).selectOption(date.slice(0,4));
 const month=Number(date.slice(5,7));
 await page.locator('.month-tabs').getByRole('button',{name:new RegExp(`^${month}(월)?$`)}).click();
 const day=page.getByTestId('schedule-day-'+date);
 if(await day.getAttribute('open')===null)await day.locator('summary').first().click();
 await day.getByTestId('schedule-task-'+task.id).getByRole('button',{name:/^(관리|Manage)$/}).click();
 await page.getByRole('dialog').getByRole('button',{name:/^(작업지시서|Work order)$/}).click();
 const panel=page.getByTestId('equipment-missions');await expect(panel).toBeVisible();
 await expect(panel.getByTestId('work-order-packet-'+task.id)).toBeVisible();
 return panel;
}
