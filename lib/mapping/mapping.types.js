'use strict';

/**
 * @file Type definitions for Upsun mapping and the generated Lando contracts.
 */

/**
 * @typedef {Record<string, MappedService>} MappedServices
 * @typedef {Omit<MappedService, 'upsun'|'build'|'build_as_root'> & InternalBuildSteps} AssembledService
 * @typedef {object} InternalBuildSteps
 * @property {string[]} [build_internal] Builder-owned application build commands.
 * @property {string[]} [build_as_root_internal] Builder-owned root build commands.
 * @property {string[]} [run_internal] Builder-owned run commands.
 */

/**
 * @typedef {object} MappedService
 * @property {string} type Lando plugin type and optional version.
 * @property {boolean} [ssl] Enable SSL.
 * @property {string[]} [build] Application build commands.
 * @property {string[]} [build_as_root] Root build commands.
 * @property {MappedAppMetadata} [upsun] Temporary metadata consumed by the builder.
 * @property {ComposeOverrides} [overrides] Compose overrides.
 * @property {string} [via] PHP web server mode.
 * @property {string} [webroot] Webroot relative to /app.
 * @property {{vhosts?: string, php?: string, vcl?: string}} [config] Generated service configuration.
 * @property {boolean|string} [xdebug] Xdebug mode.
 * @property {string} [composer_version] Composer major or exact version.
 * @property {string} [command] Runtime command.
 * @property {number|false} [port] Runtime port.
 * @property {boolean|number} [portforward] Host port forwarding.
 * @property {boolean} [persist] Persist service data.
 * @property {{user: string, password: string, database: string}} [creds] Local credentials.
 * @property {string} [core] Solr core.
 * @property {string[]} [backends] Varnish backend names.
 * @property {boolean} [app_mount] Mount project files.
 * @property {ComposeService} [services] Compose-backed service definition.
 * @property {string[]} [mailFrom] Mailpit source services.
 */

/**
 * @typedef {object} ComposeOverrides
 * @property {string[]} [extra_hosts] Extra hosts.
 * @property {Record<string, string>} [environment] Environment overrides.
 */

/**
 * @typedef {object} ComposeService
 * @property {string} image Container image.
 * @property {string[]} command Image entrypoint and command.
 * @property {Record<string, string>} environment Container environment.
 * @property {string[]} ports Exposed ports.
 */

/**
 * @typedef {object} MappedAppMetadata
 * @property {string} role App, worker, cron or nginx role.
 * @property {string} app Model application name.
 * @property {string} [worker] Worker name.
 * @property {Record<string, import('../config/config.types').UpsunLocation>} [locations] Normalized web locations.
 * @property {Record<string, import('../config/config.types').UpsunRelationship>} [relationships] Role relationships.
 * @property {ProxyTarget|null} [proxy] Proxy destination.
 * @property {boolean} [static] Static sidecar mode.
 */

/**
 * @typedef {object} HostMapEntry
 * @property {string} host Local service hostname.
 * @property {number} port Service port.
 * @property {string} scheme Connection scheme.
 * @property {string} [ip] Optional address override supplied by callers.
 * @property {string|null} [username] Username; null for unauthenticated services.
 * @property {string|null} [password] Password; null for unauthenticated services.
 * @property {string|null} [path] Database or service path; null means no default database.
 * @property {Record<string, import('../config/config.types').ConfigValue>} [query] Connection flags.
 */

/**
 * @typedef {object} MapResult
 * @property {MappedServices} services Generated Lando services.
 * @property {Record<string, HostMapEntry>} [hostMap] Service/endpoint connection metadata.
 * @property {import('../config/config.types').UpsunWarning[]} warnings Mapping warnings.
 * @typedef {MapResult & {hostMap: Record<string, HostMapEntry>}} ServiceMapResult
 */

/**
 * @typedef {object} MappingOptions
 * @property {boolean|string} [xdebug] Xdebug mode.
 * @property {boolean} [mail] Enable mail capture.
 * @property {boolean} [crons] Enable cron sidecars.
 * @property {Record<string, string[]>} [versions] Installed plugin versions.
 * @property {Record<string, Record<string, string>>} [tags] Upsun upstream image pins.
 */

/**
 * @typedef {object} VhostOptions
 * @property {ProxyTarget|null} [upstream] HTTP upstream for non-PHP applications.
 * @property {string|null} [fpmHost] PHP-FPM service hostname, defaulting to fpm; null disables PHP for static sites.
 * @typedef {object} DatabaseEndpoint
 * @property {Record<string, string>} privileges Per-database privilege levels.
 * @property {boolean} [synthetic] Mapper-generated default endpoint.
 * @property {boolean} [replication] Replication endpoint.
 * @typedef {object} DatabaseInit
 * @property {string} dialect SQL client dialect (mysql or pgsql).
 * @property {string[]} statements Idempotent SQL initialization statements.
 * @typedef {object} VersionResolution
 * @property {string} version Selected Lando version.
 * @property {import('../config/config.types').UpsunWarning} [warning] Substitution warning.
 */

/**
 * @typedef {object} CliMeta
 * @property {string} binary CLI executable.
 * @property {string} tokenVar Vendor token variable.
 * @property {string} home CLI home directory with tilde prefix.
 * @property {'upsun'|'platformsh'} vendor Vendor identifier.
 * @typedef {CliMeta & {flavor?: import('../config/config.types').UpsunFlavor, projectId?: string, environment?: string}} SyncCliMeta
 * @typedef {object} TokenEntry
 * @property {string} token API token.
 * @property {string} email Account email or CLI picker label.
 * @property {number} date Unix timestamp in seconds.
 */

/**
 * @typedef {object} ToolingOption
 * @property {string} [description] Option description.
 * @property {string} [describe] Yargs option description.
 * @property {string|boolean} [default] Default value.
 * @property {string|boolean} [defaultDescription] Default label.
 * @property {string[]} [alias] Short aliases.
 * @property {boolean} [passthrough] Forward to helper.
 * @property {boolean} [boolean] Boolean option.
 * @property {boolean} [string] String option.
 * @property {boolean} [array] Array option.
 * @property {boolean} [hidden] Hidden option.
 * @property {ToolingPrompt} [interactive] Interactive question.
 */

/**
 * @typedef {string[]|{name: string, value: string}[]} ToolingChoices
 * @typedef {function(Record<string, string>): (ToolingChoices|Promise<ToolingChoices>)} ToolingChoicesCallback
 * @typedef {object} ToolingPrompt
 * @property {string} [name] Answer name.
 * @property {string} [type] Prompt kind.
 * @property {string} [message] Prompt label.
 * @property {ToolingChoices|ToolingChoicesCallback} [choices] Static or dynamically resolved picker choices.
 * @property {function(Record<string, unknown>): (boolean|Promise<boolean>)} [when] Prompt predicate.
 * @property {number} weight Prompt order.
 */

/**
 * @typedef {object} ToolingTask
 * @property {string} service Target service.
 * @property {string} cmd Command.
 * @property {string} [description] Help description.
 * @property {string} [dir] Working directory.
 * @property {string} [user] Execution user.
 * @property {string} [level] Bootstrap level.
 * @property {string[]} [stdio] IO modes.
 * @property {Record<string, string>} [env] CLI environment.
 * @property {Record<string, ToolingOption>} [options] Command options.
 */

/**
 * @typedef {object} LocalProxyOptions
 * @property {string} [name] Lando app name.
 * @property {string} [domain] Local domain suffix.
 * @property {string[]} [domains] Additional project domains.
 * @typedef {object} ProxyTarget
 * @property {string} service Proxy destination service.
 * @property {number} port Destination port.
 */

/**
 * @typedef {object} ProxyEntry
 * @property {string} hostname Local hostname.
 * @property {string} port Destination port as a string.
 * @property {string} pathname Route path.
 * @property {{name: string, key: string, value: string}[]} [middlewares] Traefik middleware entries.
 */

/**
 * @typedef {LocalProxyOptions & RuntimeEnvironmentOptions} EnvironmentOptions
 * @typedef {object} RuntimeEnvironmentOptions
 * @property {string} [projectId] Project ID.
 * @property {string} [branch] Git branch.
 * @property {string} [treeId] Tree identifier.
 * @property {string} [entropy] Stable entropy.
 * @property {string} [environment] Environment name.
 * @property {string} [smtpHost] SMTP hostname.
 * @property {string} [vendor] Vendor name.
 * @property {Record<string, HostMapEntry>} [hostMap] Local relationship hosts.
 * @property {Record<string, import('../config/config.types').UpsunRelationship>} [relationships] Effective role relationships.
 * @property {string[]} [omitVariables] Env-file keys omitted from promoted variables.
 */

/**
 * @typedef {object} StartCommand
 * @property {string} name Lifecycle step label.
 * @property {string} cmd Shell command.
 * @property {string} user Container user.
 * @property {Record<string, string>} [env] Container environment overrides.
 */

/**
 * @typedef {object} EngineRunCommand
 * @property {string} id Container ID.
 * @property {string[]} cmd Engine command arguments.
 * @property {string[]} compose Compose files.
 * @property {string} project Compose project.
 * @property {number} api Lando service API version.
 * @property {EngineRunOptions} opts Execution options.
 * @typedef {object} EngineRunOptions
 * @property {string} mode Execution mode.
 * @property {string} user Container user.
 * @property {string[]} services Target services.
 * @property {string} cstdio IO mode.
 * @property {Record<string, string>} environment Environment overrides.
 * @property {string} upsunStep Lifecycle step label.
 */

/**
 * @typedef {HostMapEntry & RelationshipMetadata} RelationshipPayload
 * @typedef {object} RelationshipMetadata
 * @property {string} service Target name.
 * @property {string|null} rel Relationship endpoint.
 * @property {string} type Target type and version.
 * @property {string} cluster Local cluster identifier.
 * @property {string} hostname Hostname alias.
 * @property {null} fragment URI fragment.
 * @property {boolean} public Public endpoint flag.
 * @property {boolean} host_mapped Host mapping flag.
 * @property {number} epoch Endpoint epoch.
 * @property {string[]} instance_ips Instance addresses.
 * @typedef {Omit<import('../config/config.types').UpsunRoute, 'raw'> & {original_url: string, attributes: Record<string, unknown>}} RoutePayload
 */

module.exports = {};
