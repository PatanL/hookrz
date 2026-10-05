// Rule ideas on the home page: the `home` ones from the shared list (src/data/ideas.js), drawn with the shared
// pixel set (src/ui/pixel.js). "Launch with this" opens build.html?idea=<id>.
import { pixelIcon } from './pixel.js';
import { IDEAS as ALL } from '../data/ideas.js';

export const IDEAS = ALL.filter((x) => x.home);
export const glyph = (name, { size = 24, color = '#dfe7f2', accent = '#8fcaff' } = {}) => pixelIcon(name, { size, color, accent });
