# Book Pile

A single-page web app for inventorying a stack of books with a phone camera. Point it at the
barcode on the back of a book, and the ISBN is looked up and added to a list you can export.

## How it works

- **Scanning** uses the browser's native `BarcodeDetector` where it exists (Chrome, Android)
  and falls back to [ZXing](https://github.com/zxing-js/library) everywhere else, including
  iOS Safari. Frames are cropped to the reticle before decoding to keep the loop fast.
- **Lookup** tries Open Library's books API, then its search API, then Google Books. A book
  that matches nothing is still recorded by ISBN and can be retried later.
- **Storage** is `localStorage` in the browser doing the scanning. Nothing is sent anywhere
  except the two lookup APIs. Export to CSV or JSON before clearing site data.

ISBN-10 codes are converted to ISBN-13, and check digits are validated, so a non-book barcode
is rejected rather than recorded.

## Running locally

```
python3 -m http.server 8777
```

Then open <http://localhost:8777>. Camera access needs either `localhost` or an `https://`
address — browsers refuse it over plain HTTP on a LAN address.

## Deploying

The app is three static files. Any static host works; this one deploys to Vercel with no
build step and no configuration.
