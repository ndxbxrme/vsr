'use strict'

angular.module 'vsProperty'
.controller 'PropertyCtrl', ($scope, $interval, $http, $stateParams, $timeout, $compile, $sce, auth, dezrez) ->
  $scope.auth = auth
  $scope.getProperties = dezrez.getProperties
  $scope.loading = dezrez.loading
  
  $scope.property = dezrez.getProperty($stateParams.propertyID)
  
  console.log 'Property loaded:', $scope.property
  
  $scope.hasDocument = (docName) ->
    documents = $scope.property?.Documents or $scope.property?.details?.Documents
    if documents?.length
      for document in documents
        if document.DocumentSubType?.DisplayName is docName
          return true
    false
  
  $scope.getDocumentUrl = (docName) ->
    documents = $scope.property?.Documents or $scope.property?.details?.Documents
    if documents?.length
      for document in documents
        if document.DocumentSubType?.DisplayName is docName
          return document.Url
    return ''
  
  $scope.getFeatures = ->
    descriptions = $scope.property?.details?.Descriptions
    if descriptions?.length
      for desc in descriptions
        if desc.Name is 'Features' and desc.Features?.length
          return desc.Features
    return []
  
  # Cache the map URL to prevent infinite digest loop
  $scope.mapUrl = null
  
  # # Initialize map URL when property is loaded
  # initializeMap = ->
  #   if $scope.property?.Address?.Location?.Latitude and $scope.property?.Address?.Location?.Longitude
  #     location = $scope.property.Address.Location
  #     url = "https://maps.google.com/maps?q=#{location.Latitude},#{location.Longitude}&z=15&output=embed"
  #     $timeout ->
  #       $scope.mapUrl = $sce.trustAsResourceUrl(url)
  #     , 0
  
  # $scope.$watch 'property.Address.Location', (location) ->
  #   if location?.Latitude and location?.Longitude
  #     url = "https://maps.google.com/maps?q=#{location.Latitude},#{location.Longitude}&z=15&output=embed"
  #     $timeout ->
  #       $scope.mapUrl = $sce.trustAsResourceUrl(url)
  #     , 0
  #   else
  #     $scope.mapUrl = null
  # , true
  
  # # Initialize map when property details are loaded
  # $scope.$watch 'property.details', (details) ->
  #   if details
  #     initializeMap()
  # , true
  
  $scope.showFullDescription = false
  
  $scope.toggleDescription = ->
    $scope.showFullDescription = !$scope.showFullDescription
  
  floorplanModalTemplate = '''
    <div class="modal fade" id="floorplanModal" tabindex="-1" role="dialog">
      <div class="modal-dialog modal-lg" role="document">
        <div class="modal-content">
          <div class="modal-header">
            <button type="button" class="close" data-dismiss="modal" aria-label="Close">
              <span aria-hidden="true">&times;</span>
            </button>
            <h4 class="modal-title">Floorplan</h4>
          </div>
          <div class="modal-body text-center">
            <img ng-src="{{getDocumentUrl('Floorplan')}}" alt="Floorplan" style="max-width: 100%; height: auto;">
          </div>
        </div>
      </div>
    </div>
  '''
  
  floorplanModalElement = $compile(floorplanModalTemplate)($scope)
  angular.element('body').append(floorplanModalElement)
  
  $scope.openFloorplan = ->
    $timeout ->
      $('#floorplanModal').modal('show')
    , 0
  
  # Create photo gallery for fancybox
  $scope.openPhotos = ->
    images = $scope.property?.details?.Images or []
    return if !images.length
    
    # Create hidden gallery container
    galleryId = 'property-gallery-' + $stateParams.propertyID
    existingGallery = $('#' + galleryId)
    existingGallery.remove() if existingGallery.length
    
    galleryHtml = '<div id="' + galleryId + '" style="display:none;">'
    for image, index in images
      imageUrl = image.Url
      # Add width parameter for full size
      imageUrl += if imageUrl.indexOf('?') is -1 then '?width=1500' else '&width=1500'
      thumbUrl = image.Url
      thumbUrl += if thumbUrl.indexOf('?') is -1 then '?width=320' else '&width=320'
      
      galleryHtml += '<a href="' + imageUrl + '" class="fancybox-gallery" rel="property-gallery" data-fancybox-group="property-gallery">'
      galleryHtml += '<img src="' + thumbUrl + '" alt="Property Image ' + (index + 1) + '">'
      galleryHtml += '</a>'
    
    galleryHtml += '</div>'
    
    $('body').append(galleryHtml)
    
    # Initialize and open fancybox
    $timeout ->
      $('.fancybox-gallery').fancybox
        openEffect: 'fade'
        closeEffect: 'fade'
        prevEffect: 'fade'
        nextEffect: 'fade'
        padding: 0
        helpers:
          overlay:
            locked: false
          title:
            type: 'inside'
      
      # Trigger click on first image to open gallery
      $('.fancybox-gallery').first().trigger('click')
    , 0