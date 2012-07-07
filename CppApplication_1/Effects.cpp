/* 
 * File:   Effects.cpp
 * Author: Exiiile
 * 
 * Created on June 20, 2012, 1:53 PM
 */

#include "Effects.h"

Effects::Effects(int a, int b, int c, TCODColor d,TCODColor e,bool f,bool g) : Drawable (a,b,c,d,e,f,g) {
}

Effects::Effects(int c, TCODColor d,TCODColor e,bool f,bool g) : Drawable (c,d,e,f,g) {
     x=0;//temp
     y=8;//temp

}



Effects::~Effects() {
}

