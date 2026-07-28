from playwright.sync_api import sync_playwright
import time

def verify_frontend():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 720})

        print("Navigating to local server...")
        page.goto('http://localhost:8080/ff/')
        page.wait_for_load_state("networkidle")

        print("Taking screenshot of the main page...")
        page.screenshot(path="verification-1.png")

        print("Clicking 'How it Works' link...")
        page.click("#how-it-works-link")

        # Wait for modal to be visible and animation to finish
        page.wait_for_selector("#how-it-works-modal:not([hidden])")
        time.sleep(1) # wait for mermaid to render

        print("Taking screenshot of the modal...")
        page.screenshot(path="verification-2.png")

        browser.close()
        print("Frontend verification completed. Screenshots saved.")

if __name__ == "__main__":
    verify_frontend()
