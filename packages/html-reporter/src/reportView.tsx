/*
  Copyright (c) Microsoft Corporation.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

import type { FilteredStats, TestCase, TestCaseSummary, TestFile, TestFileSummary } from './types';
import * as React from 'react';
import './colors.css';
import './common.css';
import { Filter } from './filter';
import { HeaderView } from './headerView';
import { Route, SearchParamsContext } from './links';
import type { LoadedReport } from './loadedReport';
import './reportView.css';
import { TestCaseView } from './testCaseView';
import { TestFilesHeader, TestFilesView } from './testFilesView';
import './theme.css';

declare global {
  interface Window {
    playwrightReportBase64?: string;
  }
}

// These are extracted to preserve the function identity between renders to avoid re-triggering effects.
const testFilesRoutePredicate = (params: URLSearchParams) => !params.has('testId');
const testCaseRoutePredicate = (params: URLSearchParams) => params.has('testId');

type TestModelSummary = {
  files: TestFileSummary[];
  tests: TestCaseSummary[];
};

export const ReportView: React.FC<{
  report: LoadedReport | undefined,
}> = ({ report }) => {
  const searchParams = React.useContext(SearchParamsContext);
  const [expandedFiles, setExpandedFiles] = React.useState<Map<string, boolean>>(new Map());
  const [filterText, setFilterText] = React.useState(searchParams.get('q') || '');
  const [metadataVisible, setMetadataVisible] = React.useState(false);

  const testIdToFileIdMap = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const file of report?.json().files || []) {
      for (const test of file.tests)
        map.set(test.testId, file.fileId);
    }
    return map;
  }, [report]);

  const filter = React.useMemo(() => Filter.parse(filterText), [filterText]);
  const filteredStats = React.useMemo(() => filter.empty() ? undefined : computeStats(report?.json().files || [], filter), [report, filter]);
  const filteredTests = React.useMemo(() => {
    const result: TestModelSummary = { files: [], tests: [] };
    const testsByPath = new Map<string, TestCaseSummary[]>();
    
    // First, collect tests by their path + title (unique test identifier)
    for (const file of report?.json().files || []) {
      for (const test of file.tests) {
        if (filter.matches(test)) {
          const testKey = [...test.path, test.title].join(' › ');
          if (!testsByPath.has(testKey)) {
            testsByPath.set(testKey, []);
          }
          testsByPath.get(testKey)!.push(test);
        }
      }
    }
    
    // Group tests that have the same path and title but different projects
    for (const file of report?.json().files || []) {
      const fileTests: TestCaseSummary[] = [];
      
      for (const test of file.tests) {
        if (filter.matches(test)) {
          const testKey = [...test.path, test.title].join(' › ');
          const groupedTests = testsByPath.get(testKey);
          
          // If this test is already processed or doesn't exist, skip it
          if (!groupedTests || groupedTests.length === 0) continue;
          
          // Take the first test as the representative for the group
          const representativeTest = { ...groupedTests[0] };
          
          // Update outcome to worst case across all projects
          let hasFailure = false;
          let hasFlaky = false;
          
          // Store project references and summary results
          representativeTest.projectResults = groupedTests.map(t => ({
            testId: t.testId,
            projectName: t.projectName
          }));
          
          // Store summary results with project info
          representativeTest.results = [];
          for (const t of groupedTests) {
            if (t.outcome === 'unexpected') hasFailure = true;
            if (t.outcome === 'flaky') hasFlaky = true;
            
            // Keep track of each project's results with project name
            const projectResults = t.results.map(r => ({ 
              ...r,
              projectName: t.projectName
            }));
            representativeTest.results.push(...projectResults);
          }
          
          // Update outcome based on all grouped tests
          if (hasFailure) {
            representativeTest.outcome = 'unexpected';
            representativeTest.ok = false;
          } else if (hasFlaky) {
            representativeTest.outcome = 'flaky';
            representativeTest.ok = false;
          }
          
          // Add merged test to this file's tests
          fileTests.push(representativeTest);
          
          // Clear the tests from the map so we don't process them again
          testsByPath.set(testKey, []);
        }
      }
      
      if (fileTests.length) {
        result.files.push({ ...file, tests: fileTests });
        result.tests.push(...fileTests);
      }
    }
    
    return result;
  }, [report, filter]);

  return <div className='htmlreport vbox px-4 pb-4'>
    <main>
      {report?.json() && <HeaderView stats={report.json().stats} filterText={filterText} setFilterText={setFilterText}></HeaderView>}
      <Route predicate={testFilesRoutePredicate}>
        <TestFilesHeader report={report?.json()} filteredStats={filteredStats} metadataVisible={metadataVisible} toggleMetadataVisible={() => setMetadataVisible(visible => !visible)}/>
        <TestFilesView
          tests={filteredTests.files}
          expandedFiles={expandedFiles}
          setExpandedFiles={setExpandedFiles}
          projectNames={report?.json().projectNames || []}
        />
      </Route>
      <Route predicate={testCaseRoutePredicate}>
        {!!report && <TestCaseViewLoader report={report} tests={filteredTests.tests} testIdToFileIdMap={testIdToFileIdMap} />}
      </Route>
    </main>
  </div>;
};

const TestCaseViewLoader: React.FC<{
  report: LoadedReport,
  tests: TestCaseSummary[],
  testIdToFileIdMap: Map<string, string>,
}> = ({ report, testIdToFileIdMap, tests }) => {
  const searchParams = React.useContext(SearchParamsContext);
  const [test, setTest] = React.useState<TestCase | undefined>();
  const testId = searchParams.get('testId');
  const run = +(searchParams.get('run') || '0');

  const { prev, next } = React.useMemo(() => {
    const index = tests.findIndex(t => t.testId === testId);
    const prev = index > 0 ? tests[index - 1] : undefined;
    const next = index < tests.length - 1 ? tests[index + 1] : undefined;
    return { prev, next };
  }, [testId, tests]);

  React.useEffect(() => {
    (async () => {
      if (!testId || testId === test?.testId)
        return;
      const fileId = testIdToFileIdMap.get(testId);
      if (!fileId)
        return;
      const file = await report.entry(`${fileId}.json`) as TestFile;
      for (const t of file.tests) {
        if (t.testId === testId) {
          // Find the test in our filtered list which may have merged results
          const mergedTest = tests.find(test => test.testId === testId);
          
          if (mergedTest && mergedTest.projectResults && mergedTest.projectResults.length > 0) {
            // We need to load the detailed test results for each project
            const projectPromises = mergedTest.projectResults.map(async (projectResult) => {
              const projectFileId = testIdToFileIdMap.get(projectResult.testId);
              if (!projectFileId) return null;
              
              const projectFile = await report.entry(`${projectFileId}.json`) as TestFile;
              const projectTest = projectFile.tests.find(t => t.testId === projectResult.testId);
              return projectTest ? { 
                ...projectTest,
                projectName: projectResult.projectName
              } : null;
            });
            
            // Wait for all project tests to load
            const projectTests = (await Promise.all(projectPromises)).filter(Boolean) as TestCase[];
            
            // Create a merged test with all project results
            if (projectTests.length > 0) {
              // Combine all project test results
              const combinedResults: TestResult[] = [];
              
              projectTests.forEach(projectTest => {
                projectTest.results.forEach((result, retryIndex) => {
                  combinedResults.push({
                    ...result,
                    projectName: projectTest.projectName,
                    retry: retryIndex  // Keep the original retry index for each project
                  });
                });
              });
              
              // Create the full test with all project results
              const fullTest: TestCase = {
                ...t,  // Base structure from original test
                results: combinedResults
              };
              
              setTest(fullTest);
            } else {
              setTest(t);
            }
          } else {
            setTest(t);
          }
          break;
        }
      }
    })();
  }, [test, report, testId, testIdToFileIdMap, tests]);

  return <TestCaseView
    projectNames={report.json().projectNames}
    next={next}
    prev={prev}
    test={test}
    run={run}
  />;
};

function computeStats(files: TestFileSummary[], filter: Filter): FilteredStats {
  const stats: FilteredStats = {
    total: 0,
    duration: 0,
  };
  for (const file of files) {
    const tests = file.tests.filter(t => filter.matches(t));
    stats.total += tests.length;
    for (const test of tests)
      stats.duration += test.duration;
  }
  return stats;
}
