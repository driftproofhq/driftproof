#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Site builder: {"href":"/badges/","label":"Skill badges"}
'use strict';
const {build} = require('./published-badges');
const check = process.argv.includes('--check');
const count = build({check});
console.log(check ? 'published badges: ' + count + ' files are current' : 'published badges: ' + count + ' files written');
