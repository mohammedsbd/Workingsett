import { parseAsInteger } from 'nuqs/server';

/**
 * The overview's date range in days (URL state). Shared by the server page
 * and the client view, so it must not live in a 'use client' module.
 */
export const rangeParser = parseAsInteger.withDefault(30);
