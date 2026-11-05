const registry = require('../config/workflow-guides.json');

function workflowGuide(id) {
  return registry.workflows.find(workflow => workflow.id === id) ?? null;
}

function guideTime(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

function publicGuidePath(value, extension) {
  return typeof value === 'string' && new RegExp(`^/guides/[a-z0-9][a-z0-9/_-]*\\.${extension}$`).test(value)
    && !value.includes('//');
}

module.exports = { workflowGuide, guideTime, publicGuidePath };
