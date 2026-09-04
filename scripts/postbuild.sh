#!/bin/sh
# Post-build script: flatten TanStack Start client output and create index.html
# for static hosting (Freebuff).

set -e

# Move client assets to dist/ root
if [ -d dist/client ]; then
  mv dist/client/* dist/ 2>/dev/null || true
  rm -rf dist/client
fi

# Remove server output (not needed for static hosting)
rm -rf dist/server

# Find the entry JS file (pattern: index-*.js)
ENTRY_JS=$(ls dist/assets/index-*.js 2>/dev/null | head -1)
if [ -z "$ENTRY_JS" ]; then
  echo "ERROR: No index entry JS found in dist/assets/"
  exit 1
fi
ENTRY_JS="assets/$(basename "$ENTRY_JS")"

# Find the CSS file (pattern: styles-*.css)
CSS_FILE=$(ls dist/assets/styles-*.css 2>/dev/null | head -1)
if [ -z "$CSS_FILE" ]; then
  echo "ERROR: No styles CSS found in dist/assets/"
  exit 1
fi
CSS_FILE="assets/$(basename "$CSS_FILE")"

# Generate index.html
cat > dist/index.html <<HTMLEOF
<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Aroless — Find Winning Products</title>
<link rel="icon" href="/favicon.png" type="image/png" />
<link rel="stylesheet" href="/${CSS_FILE}" />
</head>
<body>
<div id="root"></div>
<script type="module" src="/${ENTRY_JS}"></script>
</body>
</html>
HTMLEOF

echo "postbuild: dist/index.html created (${ENTRY_JS}, ${CSS_FILE})"
