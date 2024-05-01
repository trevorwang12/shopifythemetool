import './style.css';
import * as d3 from 'd3';
import graph from './graph.json';
import { SerializableGraph, ThemeGraph } from '@shopify/theme-graph';

interface Node extends d3.SimulationNodeDatum {
  type: string;
  kind: string;
  path: string;
  parents: Record<string, Node>;
  dependencies: Record<string, Node>;
}

interface Link extends d3.SimulationLinkDatum<Node> {
  // ??
  value: number;
  // source: ; // path
  // target: string; // path
}

function chart(app: any, graph: SerializableGraph) {
  // Specify the dimensions of the chart.
  let { width, height } = app.getBoundingClientRect();

  window.addEventListener('resize', () => {
    ({ width, height } = app.getBoundingClientRect());
    svg
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', () => [-width / 2, -height / 2, width, height])
      .attr('style', 'max-width: 100%; height: auto;');
  });

  // Specify the color scale.
  const color = d3.scaleOrdinal(d3.schemeCategory10);

  const nodes: Node[] = graph.nodes.map((node) => ({
    ...node,
    parents: {},
    dependencies: {},
  }));
  const links: Link[] = graph.edges.map((edge) => ({
    ...edge,
    value: 2,
  }));

  links.forEach((link) => bind(link, nodes));

  function linkAccessor(d: Node): string {
    return d.path;
  }

  // Create a simulation with several forces.
  const simulation = d3
    .forceSimulation(nodes)
    .force('link', d3.forceLink<Node, Link>(links).id(linkAccessor).distance(30))
    .force('charge', d3.forceManyBody().strength(-200))
    .force('x', d3.forceX())
    .force('y', d3.forceY());

  // Create the SVG container.
  const svg = d3
    .create('svg')
    .attr('width', () => width)
    .attr('height', () => height)
    .attr('viewBox', () => [-width / 2, -height / 2, width, height])
    .attr('style', 'max-width: 100%; height: auto;');

  const g = svg.append('g');

  // Add a line for each link, and a circle for each node.
  const link = g
    .append('g')
    .attr('stroke', '#999')
    .attr('stroke-opacity', 0.6)
    .selectAll('line')
    .data(links)
    .join('line')
    .attr('stroke-width', (d) => Math.sqrt(d.value));

  const node = g
    .append('g')
    .attr('stroke', '#fff')
    .attr('stroke-width', 1.5)
    .selectAll('circle')
    .data(nodes)
    .join('circle')
    .attr('r', 7)
    .attr('fill', (d) => color(d.type + d.kind));

  // Add a drag behavior.
  node.call(d3.drag().on('start', dragstarted).on('drag', dragged).on('end', dragended) as any);

  // Set the position attributes of links and nodes each time the simulation ticks.
  simulation.on('tick', () => {
    link
      .attr('x1', (d) => (d as any).source.x)
      .attr('y1', (d) => (d as any).source.y)
      .attr('x2', (d) => (d as any).target.x)
      .attr('y2', (d) => (d as any).target.y);

    node.attr('cx', (d) => d.x!).attr('cy', (d) => d.y!);
  });

  // Reheat the simulation when drag starts, and fix the subject position.
  function dragstarted(event: any) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    event.subject.fx = event.subject.x;
    event.subject.fy = event.subject.y;
  }

  // Update the subject (dragged node) position during drag.
  function dragged(event: any) {
    event.subject.fx = event.x;
    event.subject.fy = event.y;
  }

  // Restore the target alpha so the simulation cools after dragging ends.
  // Unfix the subject position now that it’s no longer being dragged.
  function dragended(event: any) {
    if (!event.active) simulation.alphaTarget(0);
    event.subject.fx = null;
    event.subject.fy = null;
  }

  const tooltip = d3.select('#tooltip');
  const sidebar = d3.select('#sidebar');

  node
    .on('mouseover', function (event, d) {
      // switch class so that the node in the graph are opaque and the ones that
      // aren't are at 0.5 opacity
      const subset = subgraph(d);
      node
        .transition()
        .duration(100)
        .style('opacity', (d) => (subset.has(d) ? 1 : 0.1))
        .attr('r', (d) => (subset.has(d) ? 10 : 7));

      link
        .transition()
        .duration(100)
        .style('opacity', (d) =>
          subset.has(d.target as Node) && subset.has(d.source as Node) ? 0.6 : 0.1,
        );

      tooltip.transition().duration(100).style('opacity', 0.9);
      tooltip
        .html(d.path)
        .style('left', event.pageX + 'px')
        .style('top', event.pageY - 28 + 'px');

      sidebar.selectAll('*').remove();
      renderSidebar(d, sidebar.append('ul') as any);
      // console.log(renderToMarkdown(d));
    })
    .on('mouseout', function (d) {
      node.transition().duration(100).style('opacity', 1).attr('r', 7);
      link.transition().duration(100).style('opacity', 0.6);

      tooltip.transition().duration(500).style('opacity', 0);
    });

  let transform;

  const zoom = d3.zoom().on('zoom', (e) => {
    g.attr('transform', (transform = e.transform));
  });

  svg.call(zoom as any).call(zoom.transform as any, d3.zoomIdentity);

  return svg.node();
}

function bind(link: Link, nodes: Node[]) {
  const source = nodes.find((node) => node.path === link.source)!;
  const target = nodes.find((node) => node.path === link.target)!;
  source.dependencies[target.path] = target;
  target.parents[source.path] = source;
}

function subgraph(node: Node): Set<Node> {
  const subgraph = new Set<Node>();
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.pop()!;
    subgraph.add(current);
    for (const dep of Object.values(current.dependencies)) {
      if (!subgraph.has(dep)) {
        stack.push(dep);
      }
    }
  }
  return subgraph;
}

function renderSidebar(node: Node, el: d3.Selection<HTMLUListElement, unknown, any, unknown>) {
  el.append('li').text(node.path);
  for (const dep of Object.values(node.dependencies)) {
    el.append('ul').call((ul) => renderSidebar(dep, ul as any));
  }
}

function renderToMarkdown(node: Node, indent = 0): string {
  return `${' '.repeat(indent)}- ${node.path}\n${Object.values(node.dependencies)
    .map((dep) => renderToMarkdown(dep, indent + 2))
    .join('')}`;
}

const app = document.querySelector<HTMLDivElement>('#app')!;
app.append(chart(app, graph as SerializableGraph)!);
