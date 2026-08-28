# Scrapbook

Scrapbook is a bookmarklet designed to scrape information from a webpage. 

It currently scans the HTML to detect email addresses and numerical sequences that may represent phone numbers.
Scrapbook also analyzes all links on the page using `docParsed.querySelectorAll("a")`. It then provides the option to follow those links and perform the same scraping process on the discovered pages, allowing you to scrape multiple levels deep.

Results are published in a different tab. 
