require('leaflet');
require('leaflet.vectorgrid/dist/Leaflet.VectorGrid.js');
require('leaflet-responsive-popup');
require('leaflet-responsive-popup/leaflet.responsive.popup.css');
require('leaflet-osm');
require('leaflet-textpath');
require('mustache');
const Cookies = require('js-cookie');

require('./Osmose.Marker.css');


const OsmoseMarker = L.VectorGrid.Protobuf.extend({

  initialize(permalink, params, editor, featuresLayers, options) {
    this._permalink = permalink;
    this._editor = editor;
    this._featuresLayers = featuresLayers;
    this._remoteUrlRead = remoteUrlRead;
    L.Util.setOptions(this, options);
    const vectorTileOptions = {
      rendererFactory: L.svg.tile,
      vectorTileLayerStyles: {
        issues(properties, zoom) {
          return {
            icon: L.icon({
              iconUrl: `../images/markers/marker-b-${properties.item}.png`,
              iconSize: [17, 33],
              iconAnchor: [8, 33],
            }),
          };
        },
        limit(properties, zoom) {
          properties.limit = true;
          return {
            icon: L.icon({
              iconUrl: '../images/limit.png',
              iconSize: L.point(256, 256),
              iconAnchor: L.point(128, 128),
            }),
          };
        },
      },
      interactive: true, // Make sure that this VectorGrid fires mouse/pointer events
      getFeatureId(f) {
        return f.properties.issue_id;
      },
    };
    L.VectorGrid.Protobuf.prototype.initialize.call(this, this._buildUrl(params), vectorTileOptions);
  },

  _tileReady(coords, err, tile) {
    L.VectorGrid.Protobuf.prototype._tileReady.call(this, coords, err, tile);

    // Hack: Overload the tile size an relative position to display part of markers over the edge of the tile.
    const key = this._tileCoordsToKey(coords);
    tile = this._tiles[key];
    if (tile) {
      tile.el.setAttribute('viewBox', '-33 -33 322 322'); // 0-33, 0-33, 256+33, 256+33
      tile.el.style.width = '322px';
      tile.el.style.height = '322px';
      const transform = tile.el.style.transform.match(/translate3d\(([-0-9]+)px, ([-0-9]+)px, 0px\)/);
      const x = parseInt(transform[1], 10) - 33;
      const y = parseInt(transform[2], 10) - 33;
      tile.el.style.transform = `translate3d(${x}px, ${y}px, 0px)`;
    }
  },

  onAdd(map) {
    this._map = map;
    L.GridLayer.prototype.onAdd.call(this, map);
    /*
    this.on('mouseover', (e) => {
      if (e.layer.properties.issue_id) {
        this._openPopup(e);
      }
    }).on('mouseout', (e) => {
      if (e.layer.properties.issue_id && this.highlight != e.layer.properties.issue_id) {
        this._closePopup();
      }
    });
*/
    const click = (e) => {
      if (e.layer.properties.limit) {
        map.setZoomAround(e.latlng, map.getZoom() + 1);
      } else if (e.layer.properties.issue_id) {
        if (this.highlight === e.layer.properties.issue_id) {
          this._closePopup();
        } else {
          this.highlight = e.layer.properties.issue_id;
          this._openPopup(e);
        }
      }
    };
    this.on('click', click);

    map.on('zoomend moveend', L.Util.bind(this._mapChange, this));
    const bindClosePopup = L.Util.bind(this._closePopup, this);
    map.on('zoomstart', bindClosePopup);

    this._permalink.on('update', this._updateOsmoseLayer, this);

    this.once('remove', () => {
      this.off('click', click);
      map.off('zoomstart', bindClosePopup);
      this._permalink.off('update', this._updateOsmoseLayer, this);
    }, this);
  },

  _mapChange() {
    const cookiesOptions = {
      expires: 365,
      path: '/',
    };

    Cookies.set('last_zoom', this._map.getZoom(), cookiesOptions);
    Cookies.set('last_lat', this._map.getCenter().lat, cookiesOptions);
    Cookies.set('last_lon', this._map.getCenter().lng, cookiesOptions);
  },

  _updateOsmoseLayer(e) {
    if (this._map.getZoom() >= 6) {
      const newUrl = this._buildUrl(e.params);
      if (this._url !== newUrl) {
        this.setUrl(newUrl);
      }
    }
  },

  _buildUrl(params) {
    const p = ['level', 'fix', 'tags', 'item', 'class', 'fixable', 'useDevItem', 'source', 'username', 'country'].reduce((o, k) => {
      if (params[k] !== undefined) {
        o[k] = params[k];
      }
      return o;
    }, {});
    return `./issues/{z}/{x}/{y}.mvt${L.Util.getParamString(p)}`;
  },

  _closePopup() {
    this.highlight = undefined;
    this.open_popup = undefined;
    if (this.popup && this._map) {
      this._map.closePopup(this.popup);
    }
  },

  _openPopup(e) {
    if (this.open_popup === e.layer.properties.issue_id) {
      return;
    }
    this.open_popup = e.layer.properties.issue_id;

    const popup = L.responsivePopup({
      maxWidth: 280,
      autoPan: false,
      offset: L.point(0, -8),
    }).setLatLng(e.latlng)
      .setContent("<center><img src='../images/throbbler.gif' alt='downloading'></center>")
      .openOn(this._map);
    this.popup = popup;

    setTimeout(() => {
      if (popup.isOpen) {
        // Popup still open, so download content
        $.ajax({
          url: `../api/0.2/error/${e.layer.properties.issue_id}`,
          dataType: 'json',
          success: (data) => {
            // Get the OSM objects
            this._featuresLayers.clearLayers();
            if (data.elems_id) {
              let shift = -1; const palette = ['#ff3333', '#59b300', '#3388ff']; const
                colors = {};
              data.elems.forEach((elem) => {
                colors[elem.type + elem.id] = palette[(shift += 1) % 3];
                $.ajax({
                  url: elem.type === 'node' ? `${this._remoteUrlRead}api/0.6/node/${elem.id}`
                    : `${this._remoteUrlRead}api/0.6/${elem.type}/${elem.id}/full`,
                  dataType: 'xml',
                  success: (xml) => {
                    const layer = new L.OSM.DataLayer(xml);
                    layer.setStyle({
                      color: colors[elem.type + elem.id],
                      fillColor: colors[elem.type + elem.id],
                    });
                    layer.setText('  ►  ', {
                      repeat: true,
                      attributes: {
                        fill: colors[elem.type + elem.id],
                      },
                    });
                    this._featuresLayers.addLayer(layer);
                  },
                });
              });
            }
            // Display Popup
            const template = $('#popupTpl').html();


            const content = $(Mustache.render(template, data));
            content.on('click', '.closePopup', () => {
              setTimeout(() => {
                this.corrected(e.layer);
              }, 200);
            });
            content.on('click', '.editor_edit, .editor_fix', (event) => {
              this._editor.edit(e.layer, event.currentTarget.getAttribute('data-error'), event.currentTarget.getAttribute('data-type'), event.currentTarget.getAttribute('data-id'), event.currentTarget.getAttribute('data-fix'));
              return false;
            });
            popup.setContent(content[0]);
          },
          error: (jqXHR, textStatus, errorThrown) => {
            popup.setContent(textStatus);
          },
        });
      } else {
        popup.setContent(null);
      }
    }, 100);
  },

  corrected(layer) {
    this._closePopup();

    // Hack, removes the marker directly from the DOM since the style update of icon does not work with SVG renderer.
    // this.setFeatureStyle(layer.properties.issue_id, {});
    layer._path.remove();
  },
});


export { OsmoseMarker as default };
