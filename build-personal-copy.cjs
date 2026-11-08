'use strict';
// Local-only packager. Never commit its input or output: they contain the owner's data.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node build-personal-copy.cjs /path/to/backup.json /private/output/directory');
const root=__dirname,source=fs.readFileSync(path.join(root,'script.js'),'utf8'),prefix=source.split("$('#editorForm').addEventListener")[0];
const context={structuredClone,crypto:crypto.webcrypto,Date,URL,console};vm.createContext(context);vm.runInContext(prefix+'globalThis.recovery={migrate,validateState};})();',context);
const raw=fs.readFileSync(input,'utf8'),old=JSON.parse(raw),recovered=context.recovery.migrate(old);
for(const key of ['directions','courses','topics','sessions','homeworks','goals','timeEntries','recurrences']){assert.equal(recovered[key].length,old[key].length);for(const item of old[key]){const result=recovered[key].find(x=>x.id===item.id);assert.ok(result);for(const [field,value] of Object.entries(item))assert.equal(JSON.stringify(result[field]),JSON.stringify(value),`${key}.${field} changed`)}}
const personal=structuredClone(recovered);personal.settings.lastActiveSection='learning';personal.settings.learningView='courses';
const data=JSON.stringify(personal).replaceAll('<',String.fromCharCode(92)+'u003c');
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');html=html.replace('<link rel="stylesheet" href="style.css">',()=>'<style>'+fs.readFileSync(path.join(root,'style.css'),'utf8')+'</style>');html=html.replace('<script src="script.js" defer></script>',()=>'<script id="personalRecovery" type="application/json">'+data+'</script><script>'+source.replace(/<\/script/gi,()=>'<'+String.fromCharCode(92)+'/script')+'</script>');
fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'Study-planner-personal.html'),html);fs.writeFileSync(path.join(output,'original-backup.json'),raw);fs.writeFileSync(path.join(output,'compatible-backup.json'),JSON.stringify(recovered,null,2));
fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({originalSHA256:crypto.createHash('sha256').update(raw).digest('hex'),runtimeSHA256:Object.fromEntries(['index.html','style.css','script.js'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')])),allOriginalRecordsAndFieldsPreserved:true,sourceDate:old.exportedAt||null,personalData:true,published:false},null,2));
console.log('Personal copy prepared locally; original records and fields verified. Output: '+output);
