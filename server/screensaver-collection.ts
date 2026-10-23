/**
 * Peintures du domaine public proposées pour l’écran de veille, téléchargées à la demande
 * depuis Wikimedia Commons (1920 px de large). `file` : nom du fichier sur Commons.
 */
export interface CollectionPainting {
  key: string;
  file: string;
  title: string;
  credit: string;
}

export const screensaverCollection: readonly CollectionPainting[] = [
  {
    key: 'van-gogh-nuit-etoilee',
    file: 'Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg',
    title: 'La Nuit étoilée',
    credit: 'Vincent van Gogh, 1889',
  },
  {
    key: 'monet-impression',
    file: 'Monet_-_Impression,_Sunrise.jpg',
    title: 'Impression, soleil levant',
    credit: 'Claude Monet, 1872',
  },
  {
    key: 'hokusai-vague',
    file: 'Tsunami_by_hokusai_19th_century.jpg',
    title: 'La Grande Vague de Kanagawa',
    credit: 'Katsushika Hokusai, vers 1831',
  },
  {
    key: 'seurat-grande-jatte',
    file: 'A_Sunday_on_La_Grande_Jatte,_Georges_Seurat,_1884.jpg',
    title: 'Un dimanche après-midi à l’île de la Grande Jatte',
    credit: 'Georges Seurat, 1884',
  },
  {
    key: 'van-gogh-cypres',
    file: 'Vincent_van_Gogh_-_Wheat_Field_with_Cypresses_-_Google_Art_Project.jpg',
    title: 'Champ de blé avec cyprès',
    credit: 'Vincent van Gogh, 1889',
  },
  {
    key: 'bruegel-chasseurs',
    file: 'Pieter_Bruegel_the_Elder_-_Hunters_in_the_Snow_(Winter)_-_Google_Art_Project.jpg',
    title: 'Chasseurs dans la neige',
    credit: 'Pieter Bruegel l’Ancien, 1565',
  },
  {
    key: 'turner-temeraire',
    file: 'The_Fighting_Temeraire,_JMW_Turner,_National_Gallery.jpg',
    title: 'Le Dernier Voyage du Téméraire',
    credit: 'J. M. W. Turner, 1839',
  },
  {
    key: 'caillebotte-pluie',
    file: 'Gustave_Caillebotte_-_Paris_Street;_Rainy_Day_-_Google_Art_Project.jpg',
    title: 'Rue de Paris, temps de pluie',
    credit: 'Gustave Caillebotte, 1877',
  },
  {
    key: 'renoir-moulin',
    file: 'Pierre-Auguste_Renoir,_Le_Moulin_de_la_Galette.jpg',
    title: 'Bal du moulin de la Galette',
    credit: 'Pierre-Auguste Renoir, 1876',
  },
  {
    key: 'monet-pie',
    file: 'Claude_Monet_-_The_Magpie_-_Google_Art_Project.jpg',
    title: 'La Pie',
    credit: 'Claude Monet, 1869',
  },
  {
    key: 'van-gogh-iris',
    file: 'Irises-Vincent_van_Gogh.jpg',
    title: 'Les Iris',
    credit: 'Vincent van Gogh, 1889',
  },
  {
    key: 'van-gogh-amandier',
    file: 'Vincent_van_Gogh_-_Almond_blossom_-_Google_Art_Project.jpg',
    title: 'Amandier en fleurs',
    credit: 'Vincent van Gogh, 1890',
  },
  {
    key: 'friedrich-moine',
    file: 'Caspar_David_Friedrich_-_Der_Mönch_am_Meer_-_Google_Art_Project.jpg',
    title: 'Le Moine au bord de la mer',
    credit: 'Caspar David Friedrich, 1810',
  },
  {
    key: 'botticelli-venus',
    file: 'Sandro_Botticelli_-_La_nascita_di_Venere_-_Google_Art_Project_-_edited.jpg',
    title: 'La Naissance de Vénus',
    credit: 'Sandro Botticelli, vers 1485',
  },
  {
    key: 'monet-nympheas',
    file: 'Claude_Monet_-_Water_Lilies_-_1906,_Ryerson.jpg',
    title: 'Nymphéas',
    credit: 'Claude Monet, 1906',
  },
  {
    key: 'klimt-baiser',
    file: 'The_Kiss_-_Gustav_Klimt_-_Google_Cultural_Institute.jpg',
    title: 'Le Baiser',
    credit: 'Gustav Klimt, 1908',
  },
  {
    key: 'friedrich-voyageur',
    file: 'Caspar_David_Friedrich_-_Wanderer_above_the_sea_of_fog.jpg',
    title: 'Le Voyageur contemplant une mer de nuages',
    credit: 'Caspar David Friedrich, vers 1818',
  },
  {
    key: 'monet-ombrelle',
    file: 'Claude_Monet_-_Woman_with_a_Parasol_-_Madame_Monet_and_Her_Son_-_Google_Art_Project.jpg',
    title: 'La Promenade, la femme à l’ombrelle',
    credit: 'Claude Monet, 1875',
  },
  {
    key: 'vermeer-perle',
    file: '1665_Girl_with_a_Pearl_Earring.jpg',
    title: 'La Jeune Fille à la perle',
    credit: 'Johannes Vermeer, vers 1665',
  },
  // Peintures verticales : elles remplissent un miroir en portrait.
  {
    key: 'vinci-joconde',
    file: 'Mona_Lisa,_by_Leonardo_da_Vinci,_from_C2RMF_retouched.jpg',
    title: 'La Joconde',
    credit: 'Léonard de Vinci, vers 1503',
  },
  {
    key: 'vinci-hermine',
    file: 'Lady_with_an_Ermine_-_Leonardo_da_Vinci_-_Google_Art_Project.jpg',
    title: 'La Dame à l’hermine',
    credit: 'Léonard de Vinci, vers 1490',
  },
  {
    key: 'raphael-madone',
    file: 'Raphael_-_The_Sistine_Madonna_-_Google_Arts_&_Culture.jpg',
    title: 'La Madone Sixtine',
    credit: 'Raphaël, vers 1512',
  },
  {
    key: 'rembrandt-autoportrait',
    file: 'Rembrandt_Self-portrait_(Kenwood).jpg',
    title: 'Autoportrait aux deux cercles',
    credit: 'Rembrandt, vers 1665',
  },
  {
    key: 'vermeer-ruelle',
    file: "Johannes_Vermeer_-_Gezicht_op_huizen_in_Delft,_bekend_als_'Het_straatje'_-_Google_Art_Project.jpg",
    title: 'La Ruelle',
    credit: 'Johannes Vermeer, vers 1658',
  },
  {
    key: 'vermeer-laitiere',
    file: 'Johannes_Vermeer_-_Het_melkmeisje_-_Google_Art_Project.jpg',
    title: 'La Laitière',
    credit: 'Johannes Vermeer, vers 1658',
  },
  {
    key: 'fragonard-escarpolette',
    file: 'Fragonard,_The_Swing.jpg',
    title: 'L’Escarpolette',
    credit: 'Jean-Honoré Fragonard, vers 1767',
  },
  {
    key: 'hiroshige-averse',
    file: 'Hiroshige,_Sudden_shower_over_Shin-Ōhashi_bridge_and_Atake,_1857.jpg',
    title: 'Averse soudaine sur le pont Shin-Ōhashi',
    credit: 'Utagawa Hiroshige, 1857',
  },
  {
    key: 'renoir-soeurs',
    file: 'Pierre-Auguste_Renoir_-_Two_Sisters_(On_the_Terrace)_-_Google_Art_Project.jpg',
    title: 'Les Deux Sœurs (Sur la terrasse)',
    credit: 'Pierre-Auguste Renoir, 1881',
  },
  {
    key: 'van-gogh-autoportrait',
    file: 'Vincent_van_Gogh_-_Self-Portrait_-_Google_Art_Project_(454045).jpg',
    title: 'Autoportrait',
    credit: 'Vincent van Gogh, 1887',
  },
  {
    key: 'van-gogh-tournesols',
    file: 'Vincent_van_Gogh_-_Sunflowers_-_VGM_F458.jpg',
    title: 'Les Tournesols',
    credit: 'Vincent van Gogh, 1889',
  },
  {
    key: 'monet-rouen',
    file: 'Claude_Monet_-_Rouen_Cathedral,_West_Façade_-_Google_Art_Project.jpg',
    title: 'La Cathédrale de Rouen, le portail',
    credit: 'Claude Monet, 1894',
  },
  {
    key: 'klimt-adele',
    file: 'Klimt_-_ABBII_Portrait.jpg',
    title: 'Portrait d’Adele Bloch-Bauer II',
    credit: 'Gustav Klimt, 1912',
  },
];

export function collectionUrl(painting: CollectionPainting): string {
  return (
    'https://commons.wikimedia.org/wiki/Special:FilePath/' +
    encodeURIComponent(painting.file) +
    '?width=1920'
  );
}
