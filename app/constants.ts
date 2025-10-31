export const ACTIONS = [
  "start_item",
  "select_menu",
  "select_bread",
  "select_cheese",
  "add_vegetables",
  "remove_vegetables",
  "add_sauce",
  "remove_sauce",
  "set_quantity",
  "add_to_cart",
  "modify_cart_item",
  "remove_from_cart",
  "view_cart",
  "confirm_order",
  "complete_order",
  "cancel_order",
  "help"
];

export const BREAD_OPTIONS = ["위트", "허니오트", "파마산오레가노", "화이트", "플랫브레드"];

export const CHEESE_OPTIONS = ["아메리칸치즈", "슈레드치즈", "모짜렐라치즈"];

export const VEGETABLE_OPTIONS = [
  "양상추", "토마토", "오이", "피망", "양파", "피클", "올리브", "할라피뇨"
];

export const SAUCE_OPTIONS = [
  "랜치", "마요네즈", "스위트 어니언", "허니 머스타드", "스위트 칠리", 
  "사우스웨스트", "핫 칠리", "올리브오일"
];

export const MENU = [
  {
    name: "에그마요",
    defaultBread: "위트",
    defaultCheese: "아메리칸치즈",
    defaultVegetables: ["양상추", "토마토", "오이"],
    defaultSauces: ["마요네즈"],
    description: "부드러운 계란과 마요네즈"
  },
  {
    name: "이탈리안 비엠티",
    defaultBread: "위트",
    defaultCheese: "슈레드치즈",
    defaultVegetables: ["양상추", "토마토", "양파", "피망"],
    defaultSauces: ["랜치", "올리브오일"],
    description: "페퍼로니, 살라미, 햄"
  },
  {
    name: "비엘티",
    defaultBread: "허니오트",
    defaultCheese: "아메리칸치즈",
    defaultVegetables: ["양상추", "토마토"],
    defaultSauces: ["랜치", "마요네즈"],
    description: "베이컨, 양상추, 토마토"
  },
  {
    name: "써브웨이 클럽",
    defaultBread: "위트",
    defaultCheese: "아메리칸치즈",
    defaultVegetables: ["양상추", "토마토", "오이"],
    defaultSauces: ["랜치", "스위트 어니언"],
    description: "터키, 햄, 베이컨"
  },
  {
    name: "로티세리 바비큐 치킨",
    defaultBread: "허니오트",
    defaultCheese: "아메리칸치즈",
    defaultVegetables: ["양상추", "토마토", "양파"],
    defaultSauces: ["스위트 어니언", "허니 머스타드"],
    description: "훈제 바비큐 치킨"
  },
  {
    name: "로스트 치킨",
    defaultBread: "위트",
    defaultCheese: "슈레드치즈",
    defaultVegetables: ["양상추", "토마토", "양파", "피망"],
    defaultSauces: ["스위트 칠리", "허니 머스타드"],
    description: "오븐에 구운 치킨 가슴살"
  },
  {
    name: "참치",
    defaultBread: "위트",
    defaultCheese: "아메리칸치즈",
    defaultVegetables: ["양상추", "토마토", "오이", "양파"],
    defaultSauces: ["마요네즈"],
    description: "참치와 마요네즈"
  },
  {
    name: "햄",
    defaultBread: "위트",
    defaultCheese: "아메리칸치즈",
    defaultVegetables: ["양상추", "토마토", "피클"],
    defaultSauces: ["허니 머스타드"],
    description: "슬라이스 햄"
  },
  {
    name: "베지",
    defaultBread: "허니오트",
    defaultCheese: "슈레드치즈",
    defaultVegetables: ["양상추", "토마토", "오이", "피망", "양파", "올리브"],
    defaultSauces: ["랜치", "올리브오일"],
    description: "신선한 야채 샌드위치"
  },
  {
    name: "스테이크 앤 치즈",
    defaultBread: "화이트",
    defaultCheese: "아메리칸치즈",
    defaultVegetables: ["양상추", "토마토", "피망", "양파"],
    defaultSauces: ["사우스웨스트", "핫 칠리"],
    description: "스테이크와 치즈"
  }
];
