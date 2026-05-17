// utils/permissions.js

/**
 * Returns true if the member has at least one of the given role IDs.
 * Accepts a single ID string or an array of IDs.
 */
function hasAnyRole(member, roleIds) {
    if (Array.isArray(roleIds)) {
        return roleIds.some(id => member.roles.cache.has(id));
    }
    return member.roles.cache.has(roleIds);
}

module.exports = { hasAnyRole };
