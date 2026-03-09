'use strict'

angular.module 'vsProperty'
.controller 'OffersCtrl', ($scope, $timeout, $compile, dezrez) ->
  $scope.sort = '-date'
  dezrez.fetchOffers()
  $scope.getOffers = ->
    offers = dezrez.getOffers()
    i = offers.length
    while i-- > 0
      if not offers[i].prop.details.Address
        offers.splice i, 1
    # Log all offer objects for debugging
    if offers.length > 0
      console.log '=== OFFERS DEBUG ==='
      console.log 'Total offers:', offers.length
      for offer, index in offers
        console.log "Offer #{index + 1}:", offer
        console.log "  - Applicant:", offer.ApplicantGroup?.PrimaryMember?.ContactName
        console.log "  - Amount:", offer.Value
        console.log "  - Date:", offer.DateTime
    offers
  $scope.loading = dezrez.loading
  $scope.selectedOffer = null
  
  # Create modal element and append to body
  modalTemplate = '''
    <div class="modal fade" id="offerModal" tabindex="-1" role="dialog" aria-labelledby="offerModalLabel">
      <div class="modal-dialog" role="document">
        <div class="modal-content">
          <div class="modal-header">
            <button type="button" class="close" data-dismiss="modal" aria-label="Close">
              <span aria-hidden="true">&times;</span>
            </button>
            <h4 class="modal-title" id="offerModalLabel">Offer Details</h4>
            <div class="modal-subtitle" ng-show="selectedOffer">
              <div class="person">
                <span>{{selectedOffer.ApplicantGroup.PrimaryMember.ContactName}}</span>
              </div>
              <span> - {{selectedOffer.Value | currency:'£':0}} on {{selectedOffer.DateTime | date:'mediumDate'}}</span>
            </div>
          </div>
          <div class="modal-body">
            <div class="feedback-container" ng-show="selectedOffer">
              <div class="viewing-feedback" ng-show="selectedOffer.Notes.length">
                <div class="feedback-header">
                  <h4>Notes about this offer</h4>
                </div>
                <div class="feedback-list">
                  <div class="feedback-entry" ng-repeat="note in selectedOffer.Notes">
                    <h6>{{note.DateAdded | date:'mediumDate'}}, {{note.DateAdded | date:'shortTime'}}</h6>
                    <p>{{note.Note}}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-default" data-dismiss="modal">Close</button>
          </div>
        </div>
      </div>
    </div>
  '''
  
  # Compile and append modal to body
  modalElement = $compile(modalTemplate)($scope)
  angular.element('body').append(modalElement)
  
  $scope.openOfferModal = (offer) ->
    $scope.selectedOffer = offer
    $timeout ->
      $('#offerModal').modal('show')
    , 0
  
  $scope.$on '$destroy', ->
    $('#offerModal').modal('hide')
    modalElement.remove()
    $scope.selectedOffer = null