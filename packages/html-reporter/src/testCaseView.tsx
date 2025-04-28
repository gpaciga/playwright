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

import type { TestCase, TestCaseAnnotation, TestCaseSummary } from './types';
import * as React from 'react';
import { TabbedPane } from './tabbedPane';
import { AutoChip } from './chip';
import './common.css';
import { Link, ProjectLink, SearchParamsContext, testResultHref } from './links';
import { statusIcon } from './statusIcon';
import './testCaseView.css';
import { TestResultView } from './testResultView';
import { linkifyText } from '@web/renderUtils';
import { hashStringToInt, msToString } from './utils';
import { clsx } from '@web/uiUtils';
import { CopyToClipboardContainer } from './copyToClipboard';

export const TestCaseView: React.FC<{
  projectNames: string[],
  test: TestCase | undefined,
  next: TestCaseSummary | undefined,
  prev: TestCaseSummary | undefined,
  run: number,
}> = ({ projectNames, test, run, next, prev }) => {
  const [selectedProjectIndex, setSelectedProjectIndex] = React.useState(run);
  const [selectedRetryIndices, setSelectedRetryIndices] = React.useState<Record<string, number>>({});
  const searchParams = React.useContext(SearchParamsContext);
  const filterParam = searchParams.has('q') ? '&q=' + searchParams.get('q') : '';

  const labels = React.useMemo(() => {
    if (!test)
      return undefined;
    return test.tags;
  }, [test]);

  const visibleAnnotations = React.useMemo(() => {
    return test?.annotations?.filter(annotation => !annotation.type.startsWith('_')) || [];
  }, [test?.annotations]);

  return <div className='test-case-column vbox'>
    {test && <div className='hbox'>
      <div className='test-case-path'>{test.path.join(' › ')}</div>
      <div style={{ flex: 'auto' }}></div>
      <div className={clsx(!prev && 'hidden')}><Link href={testResultHref({ test: prev }) + filterParam}>« previous</Link></div>
      <div style={{ width: 10 }}></div>
      <div className={clsx(!next && 'hidden')}><Link href={testResultHref({ test: next }) + filterParam}>next »</Link></div>
    </div>}
    {test && <div className='test-case-title'>{test?.title}</div>}
    {test && <div className='hbox'>
      <div className='test-case-location'>
        <CopyToClipboardContainer value={`${test?.location.file}:${test?.location.line}`}>
          {test.location.file}:{test.location.line}
        </CopyToClipboardContainer>
      </div>
      <div style={{ flex: 'auto' }}></div>
      <div className='test-case-duration'>{msToString(test.duration)}</div>
    </div>}
    {test && (!!test.projectName || labels) && <div className='test-case-project-labels-row'>
      {/* Show all unique project names if the test has results from multiple projects */}
    {test && test.results.length > 0 && 
      <div className="test-case-projects">
        {Array.from(new Set(test.results.map(r => r.projectName))).filter(Boolean).map(projectName => 
          <ProjectLink key={projectName} projectNames={projectNames} projectName={projectName!}></ProjectLink>
        )}
      </div>
    }
      {labels && <LabelsLinkView labels={labels} />}
    </div>}
    {!!visibleAnnotations.length && <AutoChip header='Annotations'>
      {visibleAnnotations.map((annotation, index) => <TestCaseAnnotationView key={index} annotation={annotation} />)}
    </AutoChip>}
    {test && (() => {
      // Group results by project
      const resultsByProject = new Map<string, TestResult[]>();
      
      for (const result of test.results) {
        const projectName = result.projectName || 'Unknown';
        if (!resultsByProject.has(projectName)) {
          resultsByProject.set(projectName, []);
        }
        resultsByProject.get(projectName)!.push(result);
      }
      
      // Create tabs for each project's results
      const tabs = Array.from(resultsByProject.entries()).map(([projectName, results], projectIndex) => {
        // Sort results by retry index within each project
        results.sort((a, b) => a.retry - b.retry);
        
        // For each project, create a tab
        return {
          id: String(projectIndex),
          title: <div style={{ display: 'flex', alignItems: 'center' }}>
            {/* Show project status based on worst result */}
            {statusIcon(results.some(r => r.status === 'failed' || r.status === 'timedOut') ? 'failed' : 'passed')}
            <span className="test-case-project-name">{projectName}</span>
            <span className='test-case-run-duration'>{msToString(results.reduce((sum, r) => sum + r.duration, 0))}</span>
          </div>,
          render: () => {
            // Each project tab manages its own selected retry index
            const [selectedRetryIndex, setSelectedRetryIndex] = React.useState(0);
            
            return (
              <div className="project-result-container">
                {/* For this project, create a sub-tabbed pane for each retry */}
                <TabbedPane tabs={
                  results.map((result, retryIndex) => ({
                    id: String(retryIndex),
                    title: <div style={{ display: 'flex', alignItems: 'center' }}>
                      {statusIcon(result.status)}
                      {retryLabel(retryIndex)}
                      <span className='test-case-run-duration'>{msToString(result.duration)}</span>
                    </div>,
                    render: () => <TestResultView test={test!} result={result} />
                  }))
                } selectedTab={String(selectedRetryIndex)} setSelectedTab={id => setSelectedRetryIndex(+id)} />
              </div>
            );
          }
        };
      });
      
      return <TabbedPane
        tabs={tabs}
        selectedTab={String(selectedProjectIndex)}
        setSelectedTab={id => setSelectedProjectIndex(+id)}
      />;
    })()}
  </div>;
};

function TestCaseAnnotationView({ annotation: { type, description } }: { annotation: TestCaseAnnotation }) {
  return (
    <div className='test-case-annotation'>
      <span style={{ fontWeight: 'bold' }}>{type}</span>
      {description && <CopyToClipboardContainer value={description}>: {linkifyText(description)}</CopyToClipboardContainer>}
    </div>
  );
}

function retryLabel(index: number) {
  if (!index)
    return 'Run';
  return `Retry #${index}`;
}

const LabelsLinkView: React.FC<React.PropsWithChildren<{
  labels: string[],
}>> = ({ labels }) => {
  return labels.length > 0 ? (
    <>
      {labels.map(label => (
        <a key={label} style={{ textDecoration: 'none', color: 'var(--color-fg-default)' }} href={`#?q=${label}`} >
          <span style={{ margin: '6px 0 0 6px', cursor: 'pointer' }} className={clsx('label', 'label-color-' + hashStringToInt(label))}>
            {label.slice(1)}
          </span>
        </a>
      ))}
    </>
  ) : null;
};
