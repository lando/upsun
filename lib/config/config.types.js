'use strict';

/**
 * @file Type definitions for the normalized Upsun configuration Model.
 */

/**
 * @typedef {'flex'|'fixed'} UpsunFlavor
 * @typedef {'upsun'|'platform'|'magento'} UpsunLayout
 */

/**
 * @typedef {string|number|boolean|null|ConfigArray|ConfigObject} ConfigValue
 */

/**
 * @typedef {ConfigValue[]} ConfigArray
 */

/**
 * @typedef {{[key: string]: ConfigValue}} ConfigObject
 */

/**
 * @typedef {object} ConfigLoadOptions
 * @property {Record<string, ConfigObject>} [overrides] Raw app/service overrides keyed by existing target name; arrays merge by index.
 * @property {Record<string, ConfigObject>} [variables] Legacy app variables keyed by existing app name, merged before overrides.
 */

/**
 * @typedef {object} UpsunWarning
 * @property {string} code Warning identifier.
 * @property {string} message User-facing explanation.
 * @property {Record<string, unknown>} [data] Warning-specific context.
 */

/**
 * @typedef {object} ConfigDetection
 * @property {UpsunFlavor} flavor Configuration flavor.
 * @property {UpsunLayout} layout Configuration directory layout.
 * @property {string[]} files Source configuration paths.
 */

/**
 * @typedef {object} UpsunModel
 * @property {UpsunFlavor} flavor Configuration flavor.
 * @property {UpsunLayout} layout Configuration directory layout.
 * @property {string} root Absolute project root.
 * @property {string[]} configFiles Source configuration paths.
 * @property {Record<string, UpsunApplication>} applications Applications keyed by name.
 * @property {Record<string, UpsunService>} services Services keyed by name.
 * @property {Record<string, UpsunRoute>} routes Routes keyed by original URL.
 * @property {UpsunWarning[]} warnings Normalization warnings.
 */

/**
 * @typedef {Pick<UpsunModel, 'applications'|'services'|'routes'|'warnings'>} NormalizedConfig
 * @typedef {object} RawConfig
 * @property {Record<string, RawApplication>} applications Raw application blocks.
 * @property {Record<string, RawService>} services Raw service blocks.
 * @property {Record<string, RawRoute>} routes Raw route blocks.
 */

/**
 * @typedef {object} UpsunRelationship
 * @property {string} service Target service or application name.
 * @property {string|null} endpoint Explicit or inferred endpoint; null for unknown targets.
 */

/**
 * @typedef {(string & {service?: never, endpoint?: never})|{service?: string, endpoint?: string}|null} RawRelationship
 * @typedef {object} RelationshipResult
 * @property {Record<string, UpsunRelationship>} relationships Normalized relationships.
 * @property {UpsunWarning[]} warnings Unknown-target warnings.
 */

/**
 * @typedef {object} UpsunMount
 * @property {string} source Mount source, defaulting to local.
 * @property {string} source_path Relative source path.
 * @property {string|null} service Network-storage service, when configured.
 */

/**
 * @typedef {object} LocationRule
 * @property {boolean} [allow] Permit requests.
 * @property {boolean} [scripts] Permit scripts.
 * @property {string|boolean|null} [passthru] Front controller or inherited passthru.
 * @property {string|number} [expires] Cache lifetime.
 * @property {Record<string, string>} [headers] Response headers.
 */

/**
 * @typedef {object} UpsunLocation
 * @property {string} root Document root relative to the application.
 * @property {string|null} passthru Normalized front controller.
 * @property {string[]} index Index filenames.
 * @property {boolean} scripts Permit scripts.
 * @property {boolean} allow Permit requests.
 * @property {Record<string, LocationRule>} rules Pattern-specific overrides.
 * @property {string|number} expires Cache lifetime, defaulting to -1.
 * @property {Record<string, string>} headers Response headers.
 */

/**
 * @typedef {Partial<Omit<UpsunLocation, 'passthru'>> & {passthru?: string|boolean|null}} RawLocation
 * @typedef {object} RenderingApplication
 * @property {string} [sourceRoot] Source root for standalone nginx rendering.
 * @property {{locations?: Record<string, RawLocation>}} [web] Raw or normalized locations.
 */

/**
 * @typedef {object} UpsunWorker
 * @property {{start: string|null}} commands Worker command.
 * @property {Record<string, UpsunRelationship>} relationships Worker relationships.
 * @property {Record<string, UpsunMount>} mounts Worker mounts.
 * @property {number} [disk] Preserved worker disk allocation.
 * @property {string} [size] Preserved worker size.
 * @property {Record<string, ConfigValue>} [resources] Preserved resource settings.
 */

/**
 * @typedef {object} UpsunCron
 * @property {string} spec Cron expression.
 * @property {string} [cmd] Legacy cron command.
 * @property {{start?: string}} [commands] Cron commands.
 * @property {number} [shutdown_timeout] Shutdown timeout.
 * @property {number} [timeout] Execution timeout.
 */

/**
 * @typedef {object} UpsunApplication
 * @property {string} name Application name.
 * @property {{runtime: string, version: string, service?: never}} type Runtime descriptor.
 * @property {string} sourceRoot Source root relative to the project.
 * @property {UpsunComposable|null} composable Composable stack, or null for conventional runtimes.
 * @property {string|null} container_profile Container profile.
 * @property {Record<string, UpsunRelationship>} relationships Normalized relationships.
 * @property {Record<string, UpsunMount>} mounts Normalized mounts.
 * @property {UpsunWeb} web Normalized web configuration.
 * @property {{build: string, deploy: string, post_deploy: string}} hooks Lifecycle hooks.
 * @property {Record<string, UpsunCron>} crons Preserved cron definitions.
 * @property {Record<string, UpsunWorker>} workers Normalized worker definitions.
 * @property {Record<string, {role: string|null, commands: {start: string|null}}>} operations Runtime operations.
 * @property {Record<string, string>} additional_hosts Extra host mappings.
 * @property {{env: Record<string, ConfigValue>, [key: string]: ConfigValue}} variables Application variables.
 * @property {Record<string, Record<string, string>>} dependencies Language package dependencies.
 * @property {UpsunRuntimeOptions & {extensions: string[], disabled_extensions: string[]}} runtime Runtime options.
 * @property {{flavor?: string, [key: string]: ConfigValue}} build Preserved build settings.
 * @property {string|null} timezone Application timezone.
 * @property {RawApplication} raw Original application block.
 */

/**
 * @typedef {object} UpsunWeb
 * @property {Record<string, UpsunLocation>} locations Normalized locations (not a top-level application field).
 * @property {{pre_start: string|null, start: string|null, post_start: string|null}} commands Web commands.
 * @property {{socket_family: string, protocol: string|null}} upstream Upstream settings.
 * @property {string} document_root Selected document root.
 */

/**
 * @typedef {object} UpsunRuntimeOptions
 * @property {string[]} [extensions] Enabled extensions.
 * @property {string[]} [disabled_extensions] Disabled extensions.
 */

/**
 * @typedef {object} UpsunComposable
 * @property {string} channel Composable channel.
 * @property {{runtime: string, version: string, options: UpsunRuntimeOptions}[]} runtimes Ordered runtimes.
 * @property {string[]} packages System packages.
 */

/**
 * @typedef {Record<string, unknown> & {source?: {root?: string}, name?: string}} RawApplication
 * @typedef {object} RawService
 * @property {string} type Service type and version.
 * @property {number} [disk] Disk allocation; retained only in raw, not on UpsunService.
 * @property {ServiceConfiguration} [configuration] Service-specific configuration.
 * @property {Record<string, RawRelationship>} [relationships] Backend relationships.
 */

/**
 * @typedef {object} UpsunService
 * @property {string} name Service name.
 * @property {{service: string, version: string, runtime?: never}} type Service descriptor.
 * @property {ServiceConfiguration} configuration Preserved service configuration.
 * @property {RawService} raw Original service block, including disk and relationships.
 */

/**
 * @typedef {object} ServiceConfiguration
 * @property {string[]} [schemas] SQL schemas.
 * @property {string[]} [databases] PostgreSQL databases.
 * @property {Record<string, ServiceEndpoint>} [endpoints] Named endpoints.
 * @property {string[]|Record<string, ConfigValue>} [cores] Solr cores.
 * @property {string|{path?: string}} [vcl] Varnish configuration.
 */

/**
 * @typedef {object} ServiceEndpoint
 * @property {string|null} [default_schema] Default MySQL schema.
 * @property {string|null} [default_database] Default PostgreSQL database.
 * @property {Record<string, string>} [privileges] Per-schema privileges.
 * @property {string} [core] Solr core.
 */

/**
 * @typedef {object} RouteRedirect
 * @property {string} to Destination.
 * @property {number} [code] HTTP status code.
 * @property {boolean} [regexp] Interpret the source as a regular expression.
 * @property {boolean} [prefix] Match a path prefix.
 * @property {boolean} [append_suffix] Append the matched suffix.
 */

/**
 * @typedef {object} UpsunRoute
 * @property {string} type Route kind from the source configuration.
 * @property {string|null} upstream Upstream application endpoint.
 * @property {string|null} to Redirect destination.
 * @property {boolean} primary Selected primary route.
 * @property {string|null} id Route identifier.
 * @property {Record<string, ConfigValue>} cache Cache settings.
 * @property {Record<string, ConfigValue>} attributes Configured route attributes.
 * @property {Record<string, ConfigValue>} ssi Server-side include settings.
 * @property {{paths?: Record<string, RouteRedirect>}} redirects Path redirects.
 * @property {Record<string, ConfigValue>} tls TLS settings.
 * @property {Record<string, ConfigValue>} http_access HTTP access settings.
 * @property {RawRoute} raw Original route block.
 */

/**
 * @typedef {Partial<Omit<UpsunRoute, 'raw'|'ssi'>> & {ssi?: boolean|Record<string, ConfigValue>}} RawRoute
 * @typedef {object} LocalProject
 * @property {string} id Remote project ID.
 * @property {string|null} host Remote host when present.
 */

module.exports = {};
