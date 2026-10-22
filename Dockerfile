# syntax=docker/dockerfile:1
# mappojs.com runs on the shared PHP runtime (PHP 8.5 FPM + Apache, mail via SES,
# real visitor IPs); what's in it and why: https://github.com/rameerez/php-hosting
# The site's code is baked into the image, like a Rails app: every deploy is
# exactly the committed code, and `kamal rollback` really rolls back.
FROM 441443170551.dkr.ecr.us-east-1.amazonaws.com/rameerez/php-base:8.5

# Code never changes inside a running container, so opcache can skip checking
# file timestamps; small sites need fewer PHP workers (docs/DECISIONS.md D6, D22).
ENV PHP_OPCACHE_VALIDATE_TIMESTAMPS=0 \
    PHP_FPM_PM_MAX_CHILDREN=4

# Exactly what deploy.sh used to rsync to the old server (named sources, not
# the whole repo); .dockerignore drops *.map and .DS_Store as it did. The code
# belongs to root and is read-only for www-data.
USER root
COPY .htaccess index.html overview.html /var/www/html/
COPY demo /var/www/html/demo
COPY dist /var/www/html/dist
COPY assets /var/www/html/assets
COPY favicon /var/www/html/favicon
RUN chown root:root /var/www/html && chmod 755 /var/www/html
USER www-data
