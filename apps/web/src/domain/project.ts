/** A project folder's name, as New project and the first Save accept it (main checks the same, `Projects.createNew`). */

/** Letters, digits, spaces, `-` and `_`, not starting with a dot or a space, at most 64 characters. */
export const isProjectName = (name: string): boolean => /^[\p{L}\p{N}_-][\p{L}\p{N} _-]{0,63}$/u.test(name)
