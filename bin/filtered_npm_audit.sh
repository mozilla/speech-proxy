#!/bin/sh

set -ev

if [ -z ${CI+0} ]; then
    echo "Skipping dep lint. (set CI != 0 to run locally)";
    exit 0
fi

npm=$(npm prefix -g)/bin/npm

test -f bin/audit-filter || wget https://github.com/mozilla-services/audit-filter/releases/download/0.1.1/audit-filter-x86_64-unknown-linux-musl -O bin/audit-filter
echo "4aab86ced939727bc0d50ee5a14e01078b84217129017ed2b25c987acfe3771e bin/audit-filter" | sha256sum -c -
chmod +x bin/audit-filter
$npm --version
$npm audit --json | bin/audit-filter --nsp-config .nsprc
