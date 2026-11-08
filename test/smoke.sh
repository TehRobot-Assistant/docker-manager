#!/usr/bin/env bash
# Security smoke test for the auth/API layer. Starts its own server on a temp
# config (no Docker needed: container routes aren't exercised).
#   bash test/smoke.sh
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd); T=$(mktemp -d); PORT=${PORT:-3999}; B=http://127.0.0.1:$PORT; J='Content-Type: application/json'
(cd "$ROOT" && PORT=$PORT CONFIG_PATH=$T/config ADMIN_PASSWORD=testpass123 DOCKER_HOST=127.0.0.1:1 node server.mjs >"$T/server.log" 2>&1) & SRV=$!
trap 'kill $SRV 2>/dev/null; rm -rf "$T"' EXIT
for i in $(seq 1 50); do curl -s -o /dev/null $B/api/settings && break; sleep 0.2; done
c(){ curl -s -o /dev/null -w "%{http_code}" "$@"; }
pass=0; fail=0; t(){ if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "PASS $1"; else fail=$((fail+1)); echo "FAIL $1: got $2 want $3"; fi; }
t "login as constructor" $(c -H "$J" -d '{"username":"constructor","password":"x"}' $B/api/login) 401
t "login as __proto__" $(c -H "$J" -d '{"username":"__proto__","password":"x"}' $B/api/login) 401
t "non-string password" $(c -H "$J" -d '{"username":"admin","password":{"a":1}}' $B/api/login) 400
t "server still alive" $(c $B/api/settings) 200
t "form-encoded login refused" $(c -d 'username=admin&password=testpass123' $B/api/login) 400
t "bad JSON" $(c -H "$J" -d '{bad' $B/api/login) 400
t "cross-site POST blocked" $(c -H "$J" -H 'Sec-Fetch-Site: cross-site' -d '{"username":"admin","password":"testpass123"}' $B/api/login) 403
t "foreign Origin blocked" $(c -H "$J" -H 'Origin: https://evil.example' -d '{"username":"admin","password":"testpass123"}' $B/api/login) 403
H=$(curl -s -D - -o /dev/null -H "$J" -H 'X-Forwarded-Proto: https' -d '{"username":"admin","password":"testpass123"}' $B/api/login | grep -i set-cookie)
t "cookie HttpOnly+Lax+Secure via https proxy" "$(echo "$H" | grep -i HttpOnly | grep -i SameSite=Lax | grep -c -i Secure)" 1
t "no Secure on plain http" "$(curl -s -D - -o /dev/null -H "$J" -d '{"username":"admin","password":"testpass123"}' $B/api/login | grep -i set-cookie | grep -c -i '; secure')" 0
curl -s -c $T/a.jar -H "$J" -d '{"username":"admin","password":"testpass123"}' $B/api/login >/dev/null
t "admin session works" $(c -b $T/a.jar $B/api/admin/users) 200
t "create __proto__ user refused" $(c -b $T/a.jar -H "$J" -d '{"username":"__proto__","password":"longenough1"}' $B/api/admin/users) 400
t "create constructor user refused" $(c -b $T/a.jar -H "$J" -d '{"username":"constructor","password":"longenough1"}' $B/api/admin/users) 400
t "create user with string isAdmin" $(c -b $T/a.jar -H "$J" -d '{"username":"bob","password":"longenough1","isAdmin":"true"}' $B/api/admin/users) 200
t "string isAdmin did not grant admin" "$(curl -s -b $T/a.jar $B/api/admin/users | python3 -c "import json,sys;print([u['isAdmin'] for u in json.load(sys.stdin) if u['username']=='bob'][0])")" False
t "short password refused" $(c -b $T/a.jar -H "$J" -d '{"username":"carl","password":"short"}' $B/api/admin/users) 400
curl -s -c $T/b.jar -H "$J" -d '{"username":"bob","password":"longenough1"}' $B/api/login >/dev/null
t "bob session works" $(c -b $T/b.jar $B/api/me) 200
t "bob not admin" $(c -b $T/b.jar $B/api/admin/users) 403
t "admin resets bob pw" $(c -b $T/a.jar -X PUT -H "$J" -d '{"password":"newpassword9"}' $B/api/admin/users/bob) 200
t "bob old session killed" $(c -b $T/b.jar $B/api/me) 401
curl -s -c $T/a2.jar -H "$J" -d '{"username":"admin","password":"testpass123"}' $B/api/login >/dev/null
t "admin changes own pw" $(c -b $T/a.jar -X PUT -H "$J" -d '{"password":"adminpass456"}' $B/api/admin/users/admin) 200
t "admin current session kept" $(c -b $T/a.jar $B/api/me) 200
t "admin other session killed" $(c -b $T/a2.jar $B/api/me) 401
t "delete bob" $(c -b $T/a.jar -X DELETE $B/api/admin/users/bob) 200
t "group __proto__ refused" $(c -b $T/a.jar -H "$J" -d '{"name":"__proto__","containers":[]}' $B/api/admin/groups) 400
t "group ok" $(c -b $T/a.jar -H "$J" -d '{"name":"games","containers":["mc"]}' $B/api/admin/groups) 200
t "group bad containers" $(c -b $T/a.jar -H "$J" -d '{"name":"g2","containers":"mc"}' $B/api/admin/groups) 400
for i in $(seq 1 10); do c -H "$J" -d '{"username":"admin","password":"wrong"}' $B/api/login >/dev/null; done
t "11th attempt locked" $(c -H "$J" -d '{"username":"admin","password":"wrong"}' $B/api/login) 429
t "correct pw also locked" $(c -H "$J" -d '{"username":"admin","password":"adminpass456"}' $B/api/login) 429
t "other user not locked by user-key" $(c -H "$J" -d '{"username":"zed","password":"wrong"}' $B/api/login) 401
for i in $(seq 1 25); do c -H "$J" -d "{\"username\":\"u$i\",\"password\":\"wrong\"}" $B/api/login >/dev/null; done
t "IP limit after 30 fails" $(c -H "$J" -d '{"username":"fresh","password":"wrong"}' $B/api/login) 429
t "security headers" "$(curl -s -D - -o /dev/null $B/ | grep -i -c -E '^(x-frame-options: deny|x-content-type-options: nosniff)')" 2
t "no x-powered-by" "$(curl -s -D - -o /dev/null $B/ | grep -i -c x-powered-by)" 0
t "still alive at end" $(c $B/api/settings) 200
echo "pass=$pass fail=$fail"
[ $fail -eq 0 ]
