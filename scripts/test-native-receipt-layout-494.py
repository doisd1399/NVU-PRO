"""Isolated Android 15 layout QA. Requires Java 17+, Maven and network on first run."""
import argparse
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--maven', default=os.environ.get('NVU_MAVEN_EXECUTABLE') or shutil.which('mvn'))
parser.add_argument('--qa-dir', default=str(Path(tempfile.gettempdir()) / 'nvu-receipt-layout-494'))
args = parser.parse_args()
if not args.maven:
    parser.error('Install Maven or specify --maven /absolute/path/to/mvn')

root = Path(__file__).resolve().parent.parent
qa = Path(args.qa_dir).resolve()
qa.mkdir(parents=True, exist_ok=True)
libs = qa / 'libs'
libs.mkdir(exist_ok=True)
runtime = 'android-all-instrumented-15-robolectric-12650502-i7.jar'
artifacts = {
    runtime: 'https://repo.maven.apache.org/maven2/org/robolectric/android-all-instrumented/15-robolectric-12650502-i7/' + runtime,
    'monitor.jar': 'https://dl.google.com/dl/android/maven2/androidx/test/monitor/1.7.2/monitor-1.7.2.aar',
    'espresso-idling-resource.jar': 'https://dl.google.com/dl/android/maven2/androidx/test/espresso/espresso-idling-resource/3.6.1/espresso-idling-resource-3.6.1.aar',
}
for name, url in artifacts.items():
    target = libs / name
    if target.is_file():
        continue
    if url.endswith('.aar'):
        with urllib.request.urlopen(url, timeout=60) as response:
            with zipfile.ZipFile(io.BytesIO(response.read())) as aar:
                target.write_bytes(aar.read('classes.jar'))
    else:
        partial = target.with_suffix('.partial')
        urllib.request.urlretrieve(url, partial)
        partial.replace(target)

# Keep proxy details outside the source tree and in the same process as Maven.
settings = ET.Element('settings')
proxy_url = urllib.request.getproxies().get('https') or urllib.request.getproxies().get('http')
if proxy_url:
    proxy = urllib.parse.urlsplit(proxy_url)
    entry = ET.SubElement(ET.SubElement(settings, 'proxies'), 'proxy')
    for key, value in [('id', 'qa-proxy'), ('active', 'true'), ('protocol', 'http'),
                       ('host', proxy.hostname), ('port', str(proxy.port or 80)),
                       ('username', proxy.username), ('password', proxy.password)]:
        if value is not None:
            ET.SubElement(entry, key).text = value
settings_path = qa / 'settings.xml'
ET.ElementTree(settings).write(settings_path, encoding='utf-8', xml_declaration=True)
os.chmod(settings_path, 0o600)

target = qa / 'target'
command = [args.maven, '-B', '-q', '-U', '-s', str(settings_path), '-f',
           str(root / 'scripts/fixtures/native-receipt-494/pom.xml'),
           '-Dnvu.source=' + str(root), '-Dnvu.qa.lib=' + str(libs),
           '-Dnvu.qa.target=' + str(target), 'test']
result = subprocess.run(command, cwd=root)
if result.returncode:
    raise SystemExit(result.returncode)
suite = ET.parse(target / 'surefire-reports/TEST-com.nvu.operacional.NativeReceiptLayout494Test.xml').getroot()
report = {'engine': 'Robolectric 4.15.1 / Android 15 / native graphics',
          'tests': int(suite.get('tests', '0')), 'failures': int(suite.get('failures', '0')),
          'errors': int(suite.get('errors', '0')), 'skipped': int(suite.get('skipped', '0')),
          'cases': [test.get('name') for test in suite.findall('testcase')],
          'physicalAndroidDeviceTested': False}
if report['tests'] < 6 or any(report[key] for key in ('failures', 'errors', 'skipped')):
    raise SystemExit('Incomplete native layout QA: ' + json.dumps(report))
(root / 'reports').mkdir(exist_ok=True)
(root / 'reports/native-receipt-layout-494.json').write_text(json.dumps(report, indent=2) + '\n')
print('NATIVE_RECEIPT_LAYOUT_494_PASS: ' + str(report['tests']) + ' tests')
