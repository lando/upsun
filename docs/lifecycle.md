
## Platform.sh container lifecycle

Normally Lando expects containers to undergo a lifecycle like:

1. Pre-start build steps run if applicable
2. Container starts

In `docker-compose` terms this is generally something like:

```bash
# If there are build steps
docker-compose up
docker-compose exec appserver command1
...
docker-compose exec database command3
docker-compose kill

# Start the app
docker-compose up
```

Platform.sh containers have a more complex lifecycle

1. The container is BOOTed
2. The container undergoes a BUILD
3. The container is STARTed
4. The containers are OPENed

There are other assumptions these containers have that are provided by platform.sh's actual orchestration layer. As we do not have that layer available locally we seek to "spoof" some of those things.

Most of these things are handled by a `python` utility called the `platformsh.agent`. There are also useful wrapper scripts, utilities, templates etc that can be found in `/etc/platform` inside each platform.sh container.

Here are some key things to know about each step and what Lando does to change them.

### BOOT

1. BOOT unmounts `/etc/hosts` and `/etc/resolv.conf`. This stops Docker from controlling them so platform can
2. BOOT will setup and prepare any needed directories
3. BOOT will run `runsvdir` on `/etc/services/`
4. BOOT will send a ping to a spoofed RPC agent to mimic what platform expects
5. BOOT will finish by running `/etc/platform/boot`

Lando puts all this logic in `scripts/upsun-boot.sh` (compat wrapper: `psh-boot.sh`) and uses it for both the `BOOT` and `START` phases by putting it into `/scripts` inside of each container. Lando's entrypoint script will run anything it finds in this directory before it hands off to the "main" process/command. Also note that `/etc/platform/boot` will finish by handing off to `/etc/platform/start`.

Additionally, Lando will run `scripts/upsun-recreate-users.sh` before anything else. This script handles host:container permission mapping.

On platform.sh application containers run as `web:x:10000:10000::/app:/bin/bash` and _most_ services run as `app:x:1000:1000::/app:/bin/bash`. However locally we need whatever user is running process 1 to match the host (eg yours) uid and groupid.

### BUILD

The platform.sh BUILD step uses an internal Lando `build` step behind the scenes. This means it:

1. Only runs on the initial `lando start` and subsequent `lando rebuilds`
2. Runs _before_ the container STARTS and before any user-defined build steps

The BUILD step will use `scripts/upsun-build.sh`. This has a few differences from Platform

1. BUILD will set `$HOME` to `/var/www` instead of `/app` so build artifacts/caches dont potentially in your git repo
2. BUILD will install the platform CLI first if it needs to
3. BUILD will use `platform local:build` (for now) instead of the underlying `/etc/platform/build`

### START

Start has a similar lifecycle to `BOOT` except that it ends by running `/etc/platform/start` instead of `/etc/platform/boot`.

Once `/etc/platform/start` finishes the main process/command is run. This is `exec init` for all containers. At this point each container should have a main process running and that process shuold be controlling a bunch of other processes eg `php-fpm` and `nginx` in the case of a `php` container.

However, these containers are all "living in the dark" and need to be OPENed so they can both talk to one another and handle requests.

### OPEN

OPEN is the step that most diverges from what Lando expects in that it requires Lando do additional things AFTER an app has started. Usually once an app has started Lando expects its ready to go. This is not the case for platform. Generally the flow that needs to happen here is:

1. Lando needs to OPEN each platform service eg non-application containers
2. Lando needs to collect the output from all these commands together
3. Lando needs to merge in additional data its previously collected such as the IP addresses of services
4. Lando then needs to inject this payload when it OPENs the application containers

Once this has completed each application container will be "open for business" and ready to handle requests. This is also required to set `PLATFORM_RELATIONSHIPS` which is very important so applications can easily connect to services.

Behind the scenes we use the helper script `scripts/upsun-open.sh`. We also do the open logic in `app.js` in a `post-start` event. OPEN still sets `PLATFORM_RELATIONSHIPS` from Fixed service output.
