"use strict";

/**
 *  This file is used to fetch all current selections.
 */
var SharingViaUrl = (function () {
    var _app,
        lastrows = {},
        states = {},
        selected = {},
        MAX_DIM_WIDTH = 1,
        MAX_HEIGHT = 10000,
        _SHARING_LIMIT = 12 * 1000,
        _LOG_STATES = false;

    var SharingViaUrl = {

        /**
         * Obtains all values for the field and what is their state (selected/alternative etc.)
         * Calls itself recursively when there are a lot of rows (more than 10k).
         */
        getAllDataWithHypercube: function (_self, field, datapage, with_state, promiseresolve) {

            if (!datapage) {
                datapage = [{
                    qTop: 0,
                    qLeft: 0,
                    qWidth: MAX_DIM_WIDTH,
                    qHeight: MAX_HEIGHT
                }];
            }

            if (!lastrows[field]) {
                lastrows[field] = 0;
            }

            _app.createList({
                "qState": "$",
                "qStateName": "$",
                //
                // This below are actually KEY parameters, it adds a comprehensive information
                // on the kind of selection for each single value on the field. That is, 
                // gives alternatives, excluded and selected-excluded for each value.
                // @See / @Refer_to: 
                //  https://help.qlik.com/en-US/sense-developer/1.1/Subsystems/Workbench/Content/BuildingExtensions/API/ExtensionsApi/initialproperties-property.htm
                //
                "qShowAlternatives": true,
                "qShowExcluded": true,

                "qDef": {
                    "qShowExcluded": true,
                    "qFieldDefs": [field],
                    "qSortCriterias": [{
                        "qSortByState": 1
                    }]
                },
                "qInitialDataFetch": datapage
            }, function (reply) {

                if (!reply.qListObject) {
                    console.log('Hypercube not valid or could not be retrieved...');
                    return;
                } else {
                    //console.log('Hypercube reply');
                }
                var numrec = reply.qListObject.qSize.qcy;
                var page = reply.qListObject.qDataPages[0].qMatrix;

                for (var j = 0; j < page.length; ++j) {
                    lastrows[field]++;

                    if (!selected[field]) {
                        selected[field] = [];
                    }

                    if (_LOG_STATES) {
                        if (!states[field]) {
                            states[field] = {};
                        }
                        if (!states[field][page[j][0].qState]) {
                            states[field][page[j][0].qState] = {
                                counter: 0,
                                items: []
                            }
                        }
                        states[field][page[j][0].qState].counter++;
                        states[field][page[j][0].qState].items.push(page[j][0].qText);
                    }

                    if (with_state.indexOf(page[j][0].qState) > -1) {
                        // Only pick the fields with some specific state
                        selected[field].push(page[j][0].qText);
                    }
                }

                // Remove the hypercube to avoid it being recalled when a selection is made
                _app.destroySessionObject(reply.qInfo.qId);

                if (numrec <= (lastrows[field] + 1)) {
                    promiseresolve(true);
                    return;
                }

                // We have more data to request
                var requestPage = [{
                    qTop: lastrows[field] + 1,
                    qLeft: 0,
                    qWidth: MAX_DIM_WIDTH,
                    qHeight: MAX_HEIGHT
                }];
                _self.getAllDataWithHypercube(_self, field, requestPage, with_state, promiseresolve);

            });
        },

        _getSelections: function (sel) {
            var _self = this;
            return new Promise(function (resolve, reject) {

                if (!sel) {
                    resolve(true);
                    return;
                }

                //
                // For the states information refer to this:
                // @Refer_to: https://help.qlik.com/en-US/sense-developer/June2018/Subsystems/EngineAPI/Content/DiscoveringAndAnalysing/MakeSelections/clear-all-selections.htm 
                //
                // O -> Optional state (could be potentially selected)
                // X -> Excluded (can't be selected)
                // S -> It's currently selected
                // XS -> Excluded yet selected+
                // A -> Alternative

                // All values are selected
                var all_selection = (sel.qSelected == 'ALL');

                if (all_selection) {

                    selected[sel.qField] = ['ALL'];
                    resolve(true);

                } else if (sel.qTotal > sel.qSelectionThreshold) {

                    // If the are only a few selected values (but more than the informed limit
                    // by Sense (selectionThreshold), pick them.
                    _self.getAllDataWithHypercube(_self, sel.qField, null, ['S'], resolve);

                } else {
                    // There are a few selected values, and are lower than the SelectionThreshold limit. 
                    // Just pick them straight away.
                    var list = [];
                    for (var i = 0; i < sel.qSelectedFieldSelectionInfo.length; ++i) {
                        list.push(sel.qSelectedFieldSelectionInfo[i].qName);
                    }

                    selected[sel.qField] = list;
                    resolve(true);
                }
            });
        },

        /**
         * Wrapper to perform on a sequential manner the retrieval of selections
         */
        selectionsPromiseWrap: function (_self, selections, index, callback) {

            if (index >= selections.length) {
                callback();
                return;
            }

            _self._getSelections(selections[index]).then(function () {
                _self.selectionsPromiseWrap(_self, selections, ++index, callback);
            });

        },

        getSelectionValues: function (app, sels) {
            _app = app;
            states = {};
            var _self = this;

            selected = {};
            lastrows = {};

            return new Promise(function (resolve, reject) {

                _self.selectionsPromiseWrap(_self, sels, 0, function () {

                    if (_LOG_STATES) {
                        console.log(states);
                    }

                    var result = {};
                    var result_list = [];

                    for (var c in selected) {
                        result_list.push({
                            fieldName: c,
                            selectedCount: selected[c].length,
                            selectedValues: selected[c],
                            //isNumeric: isNumeric
                        });
                    }

                    resolve(result_list);
                });
            });
        },
    };

    return SharingViaUrl;
})();

if (typeof define === 'function' && define.amd) {
    define(function () {
        return SharingViaUrl;
    });
} else if (typeof module !== 'undefined' && module != null) {
    module.exports = SharingViaUrl;
} else if (typeof angular !== 'undefined' && angular != null) {
    angular.module('SharingViaUrl', [])
        .factory('SharingViaUrl', function () {
            return SharingViaUrl;
        });
}