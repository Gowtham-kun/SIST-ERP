"""
Sathyabama ERP Portal - Python Playwright Scraper Script
"""
import sys
import json
import asyncio
from playwright.async_api import async_playwright  # type: ignore

ERP_LOGIN_URL = "https://erp.sathyabama.ac.in/account/login?returnUrl=%2F"

async def main(reg_number, password):
    async with async_playwright() as p:
        print(f"[Python Playwright] Launching browser for {reg_number}...")
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()

        print(f"[Python Playwright] Navigating to {ERP_LOGIN_URL}...")
        await page.goto(ERP_LOGIN_URL, wait_until="networkidle")

        # Fill credentials into Angular form inputs
        await page.fill('input[type="text"], input[name="username"], #username', reg_number)
        await page.fill('input[type="password"], input[name="password"], #password', password)

        print("[Python Playwright] Submitting form...")
        await page.click('button[type="submit"], input[type="submit"]')

        await page.wait_for_timeout(3000)
        print("[Python Playwright] Authentication completed.")

        await browser.close()

if __name__ == "__main__":
    if len(sys.argv) > 2:
        asyncio.run(main(sys.argv[1], sys.argv[2]))
    else:
        print("Usage: python scraper.py <reg_number> <password>")
