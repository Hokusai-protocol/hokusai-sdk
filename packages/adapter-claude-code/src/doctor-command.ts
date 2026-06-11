import {
  createRunBootstrapDoctor,
  renderPluginDoctorReport,
  type BootstrapDoctorOptions,
} from '@hokusai/core';
import { claudeCodeHarnessProfile } from './profile.js';

export type { BootstrapDoctorOptions };
export { renderPluginDoctorReport };

export const runBootstrapDoctor =
  createRunBootstrapDoctor(claudeCodeHarnessProfile);
