# Сервер aurabulk.xyz

Сайт работает как обычный Node-сервер на одном VPS (Contabo Cloud VPS 4, Ubuntu 24.04).
Перед ним стоит Caddy, он выдаёт HTTPS. Задачи с данными запускает cron на этой
же машине, бывшие GitHub Actions больше не нужны.

| Что | Как |
| --- | --- |
| Деплой | `git push` в main. Сервер раз в 2 минуты делает pull и пересобирается, только если изменился код вне `data/` |
| Данные | `deploy/jobs.sh` по расписанию из `deploy/crontab`: пишет `data/`, коммитит и пушит в репозиторий (это бэкап) |
| Логи | `/opt/aurabulk/logs/*.log`, приложение: `journalctl -u aurabulk -f` |

## Первый запуск

### 1. Сервер

Contabo Cloud VPS 4: регион European Union, образ Ubuntu 24.04 без панели,
пароль root. Бэкапы, мониторинг и прочие опции не нужны, данные и так лежат в git.
IP и пароль Contabo присылает письмом, когда сервер готов.

Подойдёт любой другой VPS: Ubuntu 24.04, от 2 ГБ памяти, публичный IPv4.
Порты 80 и 443 должны быть открыты; если у хостинга есть свой firewall, открыть их там.

### 2. Установка

```bash
ssh root@<IP сервера>
curl -fsSLO https://raw.githubusercontent.com/MakerBuild/aurabulk/main/deploy/setup.sh
bash setup.sh
```

Под root скрипт сам создаёт пользователя `aurabulk` и продолжает работу от его имени.
Дальше на сервер заходить так: `ssh aurabulk@<IP>`.

Скрипт покажет SSH-ключ. Его нужно добавить в
GitHub → aurabulk → Settings → Deploy keys → Add, с галочкой **Allow write access**,
и нажать Enter. Дальше всё ставится само, первая сборка идёт несколько минут.
В конце должно быть `Local check: HTTP 200`.

### 3. DNS

У регистратора домена (или в Vercel → Domains, если DNS там) заменить записи:

| Тип | Имя | Значение |
| --- | --- | --- |
| A | `@` | IP сервера |
| A | `www` | IP сервера |

Старые записи Vercel (`76.76.21.21`, `cname.vercel-dns.com`) удалить.
Когда DNS обновится, Caddy сам получит сертификаты, обычно это минуты.

## Повседневное

```bash
# пересобрать прямо сейчас
/opt/aurabulk/repo/deploy/update.sh --force

# запустить задачу вручную (levels | volume | tvl | aura | watch)
/opt/aurabulk/repo/deploy/jobs.sh levels

# срочный откат на предыдущий релиз
ls -t /opt/aurabulk/releases
ln -sfn /opt/aurabulk/releases/<sha> /opt/aurabulk/current && sudo systemctl restart aurabulk
```

Срочный откат держится до следующей проверки, то есть до 2 минут. После неё
сервер снова соберёт main. Постоянный откат делается через `git revert` и push.
